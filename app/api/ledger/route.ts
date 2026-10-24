import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LedgerDocument } from '@/lib/db/types';

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

async function readServerDocs(): Promise<LedgerDocument[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ServerDatabaseFile;
    if (parsed && Array.isArray(parsed.documents)) {
      return parsed.documents;
    }
    return [];
  } catch {
    return [];
  }
}

async function writeServerDocs(documents: LedgerDocument[]): Promise<void> {
  await ensureDataDir();
  const payload: ServerDatabaseFile = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    documents,
  };
  await fs.writeFile(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

async function appendToTrash(doc: LedgerDocument): Promise<void> {
  await ensureDataDir();
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
        };
        byId.set(merged.id, merged);
        const updatedList = Array.from(byId.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        await writeServerDocs(updatedList);
        return { status: 200, payload: { success: true, document: merged, documents: updatedList } };
      }

      if (action === 'sync_merge' && Array.isArray(documents)) {
        for (const incoming of documents) {
          if (!incoming || !incoming.id) continue;
          const current = byId.get(incoming.id);
          if (!current) {
            byId.set(incoming.id, incoming);
          } else {
            const incomingTime = new Date(incoming.updatedAt).getTime();
            const currentTime = new Date(current.updatedAt).getTime();
            if (incomingTime >= currentTime) {
              byId.set(incoming.id, {
                ...incoming,
                createdAt: current.createdAt || incoming.createdAt,
              });
            }
          }
        }
        const mergedList = Array.from(byId.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        await writeServerDocs(mergedList);
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
          await writeServerDocs(remaining);
        }
        return { status: 200, payload: { success: true } };
      }

      if (action === 'replace_all' && Array.isArray(documents)) {
        for (const oldDoc of existing) {
          await appendToTrash(oldDoc);
        }
        const sorted = [...documents].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
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
