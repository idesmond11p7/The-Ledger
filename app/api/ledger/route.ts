import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LedgerDocument } from '@/lib/db/types';
import {
  readAllMarkdownRecords,
  writeDocumentMarkdownFile,
  moveDocumentMarkdownToTrash,
  writeLedgerManifest,
  getRecordRelativePath,
} from '@/lib/ledger-fs';

export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'ledger-db.json');
const TRASH_FILE = path.join(DATA_DIR, 'ledger-trash.json');

interface ServerDatabaseFile {
  schemaVersion: number;
  updatedAt: string;
  documents: LedgerDocument[];
}

// Serialized mutex queue to prevent concurrent file-write race conditions during rapid autosaves
let writeQueue: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

async function readJsonDbDocs(): Promise<LedgerDocument[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ServerDatabaseFile | LedgerDocument[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.documents)) {
      return parsed.documents;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Reconcile records from source-controlled Markdown files (/ledger/records/<type>/<id>.md)
 * and the JSON store (/data/ledger-db.json). Source-controlled .md files take priority
 * when their updatedAt is >= the JSON entry or when they exist only as .md files.
 */
async function readServerDocs(): Promise<LedgerDocument[]> {
  await ensureDataDir();
  const [mdDocs, jsonDocs] = await Promise.all([
    readAllMarkdownRecords(),
    readJsonDbDocs(),
  ]);

  const byId = new Map<string, LedgerDocument>();

  for (const d of jsonDocs) {
    if (!d || !d.id) continue;
    byId.set(d.id, {
      ...d,
      metadata: {
        ...(d.metadata || {}),
        repositoryPath: getRecordRelativePath(d),
      },
    });
  }

  let needsSyncWrite = false;
  for (const mdDoc of mdDocs) {
    if (!mdDoc || !mdDoc.id) continue;
    const existing = byId.get(mdDoc.id);
    if (!existing) {
      byId.set(mdDoc.id, mdDoc);
      needsSyncWrite = true;
    } else {
      const mdTime = new Date(mdDoc.updatedAt).getTime();
      const jsonTime = new Date(existing.updatedAt).getTime();
      if (mdTime >= jsonTime || mdDoc.body !== existing.body || mdDoc.title !== existing.title) {
        byId.set(mdDoc.id, {
          ...mdDoc,
          createdAt: existing.createdAt || mdDoc.createdAt,
        });
        needsSyncWrite = true;
      }
    }
  }

  // Ensure any doc in JSON that didn't have a .md file gets written to /ledger/records/
  const mdIds = new Set(mdDocs.map((d) => d.id));
  for (const doc of byId.values()) {
    if (!mdIds.has(doc.id)) {
      await writeDocumentMarkdownFile(doc);
      needsSyncWrite = true;
    }
  }

  const allDocs = Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (needsSyncWrite || mdDocs.length !== jsonDocs.length) {
    await writeJsonAndManifestOnly(allDocs);
  }

  return allDocs;
}

async function writeJsonAndManifestOnly(documents: LedgerDocument[]): Promise<void> {
  await ensureDataDir();
  const payload: ServerDatabaseFile = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    documents,
  };
  await Promise.all([
    fs.writeFile(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8'),
    writeLedgerManifest(documents),
  ]);
}

async function writeServerDocs(documents: LedgerDocument[], changedDoc?: LedgerDocument): Promise<void> {
  if (changedDoc) {
    await writeDocumentMarkdownFile(changedDoc);
  } else {
    for (const doc of documents) {
      await writeDocumentMarkdownFile(doc);
    }
  }
  await writeJsonAndManifestOnly(documents);
}

async function appendToTrash(doc: LedgerDocument): Promise<void> {
  await ensureDataDir();
  await moveDocumentMarkdownToTrash(doc);
  let trash: (LedgerDocument & { deletedAt: string })[] = [];
  try {
    const raw = await fs.readFile(TRASH_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) trash = parsed;
  } catch {
    trash = [];
  }
  trash.unshift({ ...doc, deletedAt: new Date().toISOString() });
  await fs.writeFile(TRASH_FILE, JSON.stringify(trash.slice(0, 200), null, 2), 'utf-8');
}

export async function GET() {
  try {
    const documents = await runSerialized(() => readServerDocs());
    return NextResponse.json(
      {
        schemaVersion: 1,
        documents,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to read server ledger store' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, document, documents, id } = body as {
      action: 'upsert' | 'sync_merge' | 'delete' | 'replace_all';
      document?: LedgerDocument;
      documents?: LedgerDocument[];
      id?: string;
    };

    const result = await runSerialized(async () => {
      const existing = await readServerDocs();
      const byId = new Map<string, LedgerDocument>(existing.map((d) => [d.id, d]));

      if (action === 'upsert' && document && document.id) {
        const prev = byId.get(document.id);
        const merged: LedgerDocument = {
          ...document,
          createdAt: prev ? prev.createdAt : document.createdAt,
          metadata: {
            ...(document.metadata || {}),
            repositoryPath: getRecordRelativePath(document),
          },
        };
        byId.set(merged.id, merged);
        const updatedList = Array.from(byId.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        await writeServerDocs(updatedList, merged);
        return { status: 200, payload: { success: true, document: merged, documents: updatedList } };
      }

      if (action === 'sync_merge' && Array.isArray(documents)) {
        for (const incoming of documents) {
          if (!incoming || !incoming.id) continue;
          const current = byId.get(incoming.id);
          if (!current) {
            const withPath: LedgerDocument = {
              ...incoming,
              metadata: {
                ...(incoming.metadata || {}),
                repositoryPath: getRecordRelativePath(incoming),
              },
            };
            byId.set(incoming.id, withPath);
            await writeDocumentMarkdownFile(withPath);
          } else {
            const incomingTime = new Date(incoming.updatedAt).getTime();
            const currentTime = new Date(current.updatedAt).getTime();
            if (incomingTime > currentTime) {
              const merged: LedgerDocument = {
                ...incoming,
                createdAt: current.createdAt || incoming.createdAt,
                metadata: {
                  ...(incoming.metadata || {}),
                  repositoryPath: getRecordRelativePath(incoming),
                },
              };
              byId.set(incoming.id, merged);
              await writeDocumentMarkdownFile(merged);
            }
          }
        }
        const mergedList = Array.from(byId.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        await writeJsonAndManifestOnly(mergedList);
        return { status: 200, payload: { success: true, documents: mergedList } };
      }

      if (action === 'delete' && id) {
        const target = byId.get(id);
        if (target) {
          await appendToTrash(target);
          byId.delete(id);
          const remaining = Array.from(byId.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          await writeJsonAndManifestOnly(remaining);
        }
        return { status: 200, payload: { success: true } };
      }

      if (action === 'replace_all' && Array.isArray(documents)) {
        for (const oldDoc of existing) {
          await appendToTrash(oldDoc);
        }
        const sorted = [...documents]
          .map((d) => ({
            ...d,
            metadata: {
              ...(d.metadata || {}),
              repositoryPath: getRecordRelativePath(d),
            },
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        await writeServerDocs(sorted);
        return { status: 200, payload: { success: true, documents: sorted } };
      }

      return { status: 400, payload: { error: `Unsupported action: ${action}` } };
    });

    return NextResponse.json(result.payload, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to persist to server ledger store' },
      { status: 500 }
    );
  }
}
