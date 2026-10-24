import fs from 'node:fs/promises';
import path from 'node:path';
import { LedgerDocument, DocumentType } from '@/lib/db/types';

export const LEDGER_ROOT = path.join(process.cwd(), 'ledger');
export const RECORDS_DIR = path.join(LEDGER_ROOT, 'records');
export const TRASH_DIR = path.join(LEDGER_ROOT, 'trash');
export const MANIFEST_FILE = path.join(LEDGER_ROOT, 'manifest.json');

const META_START = '---LEDGER_META_START---';
const META_END = '---LEDGER_META_END---';

const VALID_TYPES: DocumentType[] = [
  'chapter',
  'draft',
  'structured_chapter',
  'receipt',
  'research',
  'supporting_doc',
];

export interface ManifestEntry {
  id: string;
  title: string;
  type: DocumentType;
  status: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  source: string;
  relatedDocIds: string[];
  verificationStatus?: string;
  charCount: number;
}

export interface LedgerManifest {
  schemaVersion: number;
  updatedAt: string;
  documentCount: number;
  entries: ManifestEntry[];
}

export async function ensureLedgerDirs(): Promise<void> {
  await fs.mkdir(LEDGER_ROOT, { recursive: true });
  await fs.mkdir(RECORDS_DIR, { recursive: true });
  await fs.mkdir(TRASH_DIR, { recursive: true });
  for (const t of VALID_TYPES) {
    await fs.mkdir(path.join(RECORDS_DIR, t), { recursive: true });
  }
}

export function sanitizeIdForFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getRecordRelativePath(doc: Pick<LedgerDocument, 'id' | 'type'>): string {
  const safeType: DocumentType = VALID_TYPES.includes(doc.type) ? doc.type : 'supporting_doc';
  const safeId = sanitizeIdForFilename(doc.id);
  return `ledger/records/${safeType}/${safeId}.md`;
}

export function getRecordAbsolutePath(doc: Pick<LedgerDocument, 'id' | 'type'>): string {
  const safeType: DocumentType = VALID_TYPES.includes(doc.type) ? doc.type : 'supporting_doc';
  const safeId = sanitizeIdForFilename(doc.id);
  return path.join(RECORDS_DIR, safeType, `${safeId}.md`);
}

/**
 * Serialize a LedgerDocument into a source-controlled Markdown file with lossless metadata header
 * and exact byte-for-byte body preservation.
 */
export function serializeDocumentToMarkdown(doc: LedgerDocument): string {
  const { body, ...metaWithoutBody } = doc;
  const metaJson = JSON.stringify(metaWithoutBody, null, 2);
  return `${META_START}\n${metaJson}\n${META_END}\n${body ?? ''}`;
}

/**
 * Parse a source-controlled Markdown file back into a LedgerDocument.
 * Supports both structured ---LEDGER_META_START--- headers and raw .md files dropped into /ledger/records/<type>/.
 */
export function parseMarkdownToDocument(
  rawContent: string,
  fallbackId: string,
  fallbackType: DocumentType,
  fileMtimeIso: string
): LedgerDocument {
  if (rawContent.startsWith(META_START)) {
    const endIdx = rawContent.indexOf(`\n${META_END}\n`);
    if (endIdx !== -1) {
      const jsonPart = rawContent.slice(META_START.length + 1, endIdx);
      const bodyPart = rawContent.slice(endIdx + `\n${META_END}\n`.length);
      try {
        const meta = JSON.parse(jsonPart);
        const docType: DocumentType = VALID_TYPES.includes(meta.type) ? meta.type : fallbackType;
        return {
          id: typeof meta.id === 'string' && meta.id ? meta.id : fallbackId,
          title: typeof meta.title === 'string' && meta.title ? meta.title : fallbackId,
          type: docType,
          body: bodyPart,
          createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : fileMtimeIso,
          updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : fileMtimeIso,
          status:
            typeof meta.status === 'string'
              ? meta.status
              : docType === 'receipt'
              ? 'unresolved'
              : 'draft',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          source: typeof meta.source === 'string' ? meta.source : '',
          relatedDocIds: Array.isArray(meta.relatedDocIds) ? meta.relatedDocIds : [],
          receiptData: meta.receiptData,
          metadata:
            meta.metadata && typeof meta.metadata === 'object'
              ? { ...meta.metadata, repositoryPath: getRecordRelativePath({ id: meta.id || fallbackId, type: docType }) }
              : { repositoryPath: getRecordRelativePath({ id: meta.id || fallbackId, type: docType }) },
          schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : 1,
        };
      } catch {
        // Fall through to plain markdown parser if header JSON was manually malformed
      }
    }
  }

  // Fallback for raw Markdown files placed directly in /ledger/records/<type>/
  let inferredTitle = fallbackId.replace(/[-_]/g, ' ');
  const firstLine = rawContent.split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('# ')) {
    inferredTitle = firstLine.slice(2).trim() || inferredTitle;
  }

  return {
    id: fallbackId,
    title: inferredTitle,
    type: fallbackType,
    body: rawContent,
    createdAt: fileMtimeIso,
    updatedAt: fileMtimeIso,
    status: fallbackType === 'receipt' ? 'unresolved' : 'draft',
    tags: [],
    source: 'Source-controlled Markdown file',
    relatedDocIds: [],
    metadata: {
      repositoryPath: getRecordRelativePath({ id: fallbackId, type: fallbackType }),
    },
    schemaVersion: 1,
  };
}

/**
 * Write a single document to /ledger/records/<type>/<id>.md (cleaning up any old path if its type changed)
 */
export async function writeDocumentMarkdownFile(doc: LedgerDocument): Promise<void> {
  await ensureLedgerDirs();
  const safeId = sanitizeIdForFilename(doc.id);

  // Remove from other type folders if the document's type was changed
  for (const t of VALID_TYPES) {
    if (t !== doc.type) {
      const otherPath = path.join(RECORDS_DIR, t, `${safeId}.md`);
      try {
        await fs.unlink(otherPath);
      } catch {
        // Ignore if not present
      }
    }
  }

  const targetPath = getRecordAbsolutePath(doc);
  const docWithRepoPath: LedgerDocument = {
    ...doc,
    metadata: {
      ...(doc.metadata || {}),
      repositoryPath: getRecordRelativePath(doc),
    },
  };
  await fs.writeFile(targetPath, serializeDocumentToMarkdown(docWithRepoPath), 'utf-8');
}

/**
 * Move a document's Markdown file to /ledger/trash/ before deletion
 */
export async function moveDocumentMarkdownToTrash(doc: LedgerDocument): Promise<void> {
  await ensureLedgerDirs();
  const safeId = sanitizeIdForFilename(doc.id);
  const trashPath = path.join(TRASH_DIR, `${safeId}_${Date.now()}.md`);
  await fs.writeFile(trashPath, serializeDocumentToMarkdown(doc), 'utf-8');

  for (const t of VALID_TYPES) {
    const filePath = path.join(RECORDS_DIR, t, `${safeId}.md`);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if not present
    }
  }
}

/**
 * Scan all /ledger/records/<type>/*.md files on disk
 */
export async function readAllMarkdownRecords(): Promise<LedgerDocument[]> {
  await ensureLedgerDirs();
  const docsById = new Map<string, LedgerDocument>();

  for (const docType of VALID_TYPES) {
    const typeDir = path.join(RECORDS_DIR, docType);
    let entries: string[] = [];
    try {
      entries = await fs.readdir(typeDir);
    } catch {
      continue;
    }

    for (const filename of entries) {
      if (!filename.endsWith('.md')) continue;
      const fullPath = path.join(typeDir, filename);
      try {
        const [raw, stat] = await Promise.all([
          fs.readFile(fullPath, 'utf-8'),
          fs.stat(fullPath),
        ]);
        const fallbackId = filename.slice(0, -3);
        const doc = parseMarkdownToDocument(raw, fallbackId, docType, stat.mtime.toISOString());
        docsById.set(doc.id, doc);
      } catch {
        // Ignore unreadable file
      }
    }
  }

  return Array.from(docsById.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Rebuild and write /ledger/manifest.json from the current list of documents
 */
export async function writeLedgerManifest(documents: LedgerDocument[]): Promise<LedgerManifest> {
  await ensureLedgerDirs();
  const sorted = [...documents].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const entries: ManifestEntry[] = sorted.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type,
    status: d.status,
    filePath: getRecordRelativePath(d),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    tags: d.tags || [],
    source: d.source || '',
    relatedDocIds: d.relatedDocIds || [],
    verificationStatus: d.receiptData?.verificationStatus,
    charCount: (d.body || '').length,
  }));

  const manifest: LedgerManifest = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    documentCount: entries.length,
    entries,
  };

  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}
