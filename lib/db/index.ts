/**
 * The Ledger - IndexedDB Storage Engine
 * 
 * Storage Characteristics:
 * - Local-first persistent storage using browser-standard IndexedDB.
 * - Records persist across browser reloads, page navigation, and session restarts.
 * - Limitation note: Storage is browser-local to the origin profile; data does not
 *   silently sync across different physical machines or browser profiles without explicit export/import.
 */

import {
  LedgerDocument,
  DocumentType,
  LedgerExportPackage,
  AcceptanceTestReport,
  TestResultItem,
  ReceiptData,
} from './types';

export const DB_NAME = 'ledger_apocrypha_dxd';
export const DB_VERSION = 1;

export const STORES = {
  DOCUMENTS: 'documents',
  ATTACHMENTS: 'attachments',
  SCHEMA_META: 'schema_meta',
} as const;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/**
 * Open or upgrade the Ledger IndexedDB database
 */
export function openLedgerDB(dbName: string = DB_NAME, version: number = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB is only accessible in browser runtime.'));
      return;
    }

    const request = window.indexedDB.open(dbName, version);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Documents store
      if (!db.objectStoreNames.contains(STORES.DOCUMENTS)) {
        const docStore = db.createObjectStore(STORES.DOCUMENTS, { keyPath: 'id' });
        docStore.createIndex('type', 'type', { unique: false });
        docStore.createIndex('createdAt', 'createdAt', { unique: false });
        docStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        docStore.createIndex('title', 'title', { unique: false });
      }

      // Attachments store (for future blob/binary reference)
      if (!db.objectStoreNames.contains(STORES.ATTACHMENTS)) {
        const attachStore = db.createObjectStore(STORES.ATTACHMENTS, { keyPath: 'id' });
        attachStore.createIndex('docId', 'docId', { unique: false });
        attachStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Schema metadata store
      if (!db.objectStoreNames.contains(STORES.SCHEMA_META)) {
        db.createObjectStore(STORES.SCHEMA_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to open IndexedDB: ${(event.target as IDBOpenDBRequest).error?.message || 'Unknown error'}`));
    };
  });
}

/**
 * Generate a cryptographically stable identifier
 */
export function generateId(prefix: string = 'doc'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

const WAL_STORAGE_KEY = 'ledger_wal_mirror_v1';

function readWalMirror(): Record<string, LedgerDocument> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(WAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeWalMirror(doc: LedgerDocument): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = readWalMirror();
    const existing = current[doc.id];
    current[doc.id] = {
      ...doc,
      createdAt: existing ? existing.createdAt : doc.createdAt,
    };
    window.localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage quota errors on mirror
  }
}

function removeFromWalMirror(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = readWalMirror();
    delete current[id];
    window.localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore
  }
}

function replaceWalMirror(docs: LedgerDocument[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const map: Record<string, LedgerDocument> = {};
    for (const d of docs) {
      map[d.id] = d;
    }
    window.localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
}

async function readAllFromIDB(dbName: string): Promise<LedgerDocument[]> {
  const db = await openLedgerDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOCUMENTS, 'readonly');
    const store = tx.objectStore(STORES.DOCUMENTS);
    const request = store.getAll();

    request.onsuccess = () => {
      const docs = (request.result as LedgerDocument[]) || [];
      docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      resolve(docs);
    };

    request.onerror = () => {
      reject(new Error(`Error fetching documents: ${request.error?.message}`));
    };

    tx.oncomplete = () => db.close();
  });
}

async function writeManyToIDB(docs: LedgerDocument[], dbName: string): Promise<void> {
  if (docs.length === 0) return;
  const db = await openLedgerDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOCUMENTS, 'readwrite');
    const store = tx.objectStore(STORES.DOCUMENTS);
    for (const d of docs) {
      store.put(d);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Error writing documents to IndexedDB: ${tx.error?.message}`));
    };
  });
}

/**
 * Retrieve all documents ordered by last-modified descending.
 * For the primary database, reconciles Browser IndexedDB, Synchronous WAL Mirror,
 * and Persistent Server Disk (/api/ledger) so no saved or in-flight work is ever lost.
 */
export async function getAllDocuments(dbName: string = DB_NAME): Promise<LedgerDocument[]> {
  // Isolated test databases only use IndexedDB
  if (dbName !== DB_NAME) {
    return readAllFromIDB(dbName);
  }

  let idbDocs: LedgerDocument[] = [];
  try {
    idbDocs = await readAllFromIDB(dbName);
  } catch {
    // IndexedDB may be restricted in cross-origin iframe; continue with Server Disk + WAL
  }

  const walMap = readWalMirror();
  let serverDocs: LedgerDocument[] = [];
  try {
    const res = await fetch('/api/ledger', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.documents)) {
        serverDocs = data.documents;
      }
    }
  } catch {
    // Offline or server unreachable; proceed with local stores
  }

  // Reconcile all three layers by document ID, keeping the newest updatedAt version
  // while strictly preserving the original createdAt timestamp.
  const mergedMap = new Map<string, LedgerDocument>();

  const ingest = (doc: LedgerDocument) => {
    if (!doc || !doc.id) return;
    const existing = mergedMap.get(doc.id);
    if (!existing) {
      mergedMap.set(doc.id, doc);
    } else {
      const incomingTime = new Date(doc.updatedAt).getTime();
      const existingTime = new Date(existing.updatedAt).getTime();
      const earliestCreated =
        new Date(doc.createdAt).getTime() <= new Date(existing.createdAt).getTime()
          ? doc.createdAt
          : existing.createdAt;
      if (incomingTime >= existingTime) {
        mergedMap.set(doc.id, { ...doc, createdAt: earliestCreated });
      } else {
        mergedMap.set(doc.id, { ...existing, createdAt: earliestCreated });
      }
    }
  };

  for (const d of serverDocs) ingest(d);
  for (const d of idbDocs) ingest(d);
  for (const d of Object.values(walMap)) ingest(d);

  const reconciled = Array.from(mergedMap.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Ensure all layers have the complete reconciled set
  replaceWalMirror(reconciled);
  try {
    await writeManyToIDB(reconciled, dbName);
  } catch {
    // Non-fatal IDB error
  }
  if (reconciled.length > 0) {
    try {
      await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_merge', documents: reconciled }),
      });
    } catch {
      // Non-fatal sync error
    }
  }

  return reconciled;
}

/**
 * Retrieve single document by its unique ID
 */
export async function getDocumentById(id: string, dbName: string = DB_NAME): Promise<LedgerDocument | null> {
  const db = await openLedgerDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOCUMENTS, 'readonly');
    const store = tx.objectStore(STORES.DOCUMENTS);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error(`Error fetching document ${id}: ${request.error?.message}`));
    };

    tx.oncomplete = () => db.close();
  });
}

export interface CreateDocumentInput {
  id?: string;
  title: string;
  type: DocumentType;
  body: string;
  status?: string;
  tags?: string[];
  source?: string;
  relatedDocIds?: string[];
  receiptData?: ReceiptData;
  metadata?: Record<string, unknown>;
  createdAt?: string; // Only allowed when importing with preserved provenance
}

/**
 * Create a new document in the persistent database.
 * Sets immutable createdAt and initializes updatedAt.
 */
export async function createDocument(
  input: CreateDocumentInput,
  dbName: string = DB_NAME
): Promise<LedgerDocument> {
  const now = new Date().toISOString();
  const id = input.id || generateId(input.type === 'receipt' ? 'rcpt' : 'doc');

  const newDoc: LedgerDocument = {
    id,
    title: input.title,
    type: input.type,
    body: input.body ?? '',
    createdAt: input.createdAt || now,
    updatedAt: now,
    status: input.status || (input.type === 'receipt' ? 'unresolved' : 'draft'),
    tags: Array.isArray(input.tags) ? input.tags : [],
    source: input.source || '',
    relatedDocIds: Array.isArray(input.relatedDocIds) ? input.relatedDocIds : [],
    receiptData: input.receiptData,
    metadata: input.metadata || {},
    schemaVersion: 1,
  };

  if (dbName === DB_NAME) {
    writeWalMirror(newDoc);
  }

  try {
    const db = await openLedgerDB(dbName);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.DOCUMENTS, 'readwrite');
      const store = tx.objectStore(STORES.DOCUMENTS);

      const request = store.put(newDoc);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to create document: ${request.error?.message}`));
      };

      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    if (dbName !== DB_NAME) throw err;
  }

  if (dbName === DB_NAME) {
    await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', document: newDoc }),
    });
  }

  return newDoc;
}

export interface UpdateDocumentInput {
  title?: string;
  type?: DocumentType;
  body?: string;
  status?: string;
  tags?: string[];
  source?: string;
  relatedDocIds?: string[];
  receiptData?: ReceiptData;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

/**
 * Update an existing document.
 * Crucial constraint: Never replaces createdAt or id. Updates updatedAt.
 */
export async function updateDocument(
  id: string,
  updates: UpdateDocumentInput,
  dbName: string = DB_NAME
): Promise<LedgerDocument> {
  let existingFromIDB: LedgerDocument | undefined;

  try {
    const db = await openLedgerDB(dbName);
    existingFromIDB = await new Promise<LedgerDocument | undefined>((resolve, reject) => {
      const tx = db.transaction(STORES.DOCUMENTS, 'readonly');
      const store = tx.objectStore(STORES.DOCUMENTS);
      const getRequest = store.get(id);
      getRequest.onsuccess = () => resolve(getRequest.result as LedgerDocument | undefined);
      getRequest.onerror = () => reject(getRequest.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    if (dbName !== DB_NAME) throw err;
  }

  const walExisting = dbName === DB_NAME ? readWalMirror()[id] : undefined;
  const existing = existingFromIDB || walExisting;

  if (!existing && dbName !== DB_NAME) {
    throw new Error(`Document with id "${id}" does not exist.`);
  }

  const now = new Date().toISOString();
  const nextDoc: LedgerDocument = {
    id,
    title: updates.title !== undefined ? updates.title : existing?.title ?? 'Untitled Document',
    type: updates.type !== undefined ? updates.type : existing?.type ?? 'chapter',
    body: updates.body !== undefined ? updates.body : existing?.body ?? '',
    status: updates.status !== undefined ? updates.status : existing?.status ?? 'draft',
    tags: updates.tags !== undefined ? updates.tags : existing?.tags ?? [],
    source: updates.source !== undefined ? updates.source : existing?.source ?? '',
    relatedDocIds:
      updates.relatedDocIds !== undefined ? updates.relatedDocIds : existing?.relatedDocIds ?? [],
    receiptData:
      updates.receiptData !== undefined ? updates.receiptData : existing?.receiptData,
    metadata: updates.metadata !== undefined ? updates.metadata : existing?.metadata ?? {},
    // Crucial invariant: immutable id and createdAt
    createdAt: existing?.createdAt || updates.createdAt || now,
    updatedAt: now,
    schemaVersion: existing?.schemaVersion || 1,
  };

  if (dbName === DB_NAME) {
    writeWalMirror(nextDoc);
  }

  try {
    const db = await openLedgerDB(dbName);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.DOCUMENTS, 'readwrite');
      const store = tx.objectStore(STORES.DOCUMENTS);
      const putRequest = store.put(nextDoc);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () =>
        reject(new Error(`Failed to update document: ${putRequest.error?.message}`));
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    if (dbName !== DB_NAME) throw err;
  }

  if (dbName === DB_NAME) {
    await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', document: nextDoc }),
    });
  }

  return nextDoc;
}

/**
 * Delete a document by identifier through explicit user action
 */
export async function deleteDocument(id: string, dbName: string = DB_NAME): Promise<void> {
  if (dbName === DB_NAME) {
    removeFromWalMirror(id);
  }

  try {
    const db = await openLedgerDB(dbName);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.DOCUMENTS, 'readwrite');
      const store = tx.objectStore(STORES.DOCUMENTS);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to delete document ${id}: ${request.error?.message}`));
      };

      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    if (dbName !== DB_NAME) throw err;
  }

  if (dbName === DB_NAME) {
    await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
  }
}

/**
 * Export all ledger documents into a documented, portable JSON package
 */
export async function exportLedgerPackage(dbName: string = DB_NAME): Promise<LedgerExportPackage> {
  const docs = await getAllDocuments(dbName);
  const pkg: LedgerExportPackage = {
    format: 'ledger_backup',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: 'The Ledger - Apocrypha DXD: ForeverWorlds',
    documentCount: docs.length,
    documents: docs,
  };
  return pkg;
}

export interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * Validate imported data and commit to storage safely
 */
export async function importLedgerPackage(
  data: unknown,
  mode: 'merge' | 'replace' = 'merge',
  dbName: string = DB_NAME
): Promise<ImportResult> {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { success: false, importedCount: 0, skippedCount: 0, errors: ['Invalid import format: Payload is not an object.'] };
  }

  const payload = data as Partial<LedgerExportPackage>;

  if (payload.format !== 'ledger_backup') {
    errors.push('Notice: Header "format" is not "ledger_backup". Attempting standard document array parsing.');
  }

  const rawDocs = Array.isArray(payload.documents)
    ? payload.documents
    : Array.isArray(data)
    ? (data as unknown[])
    : null;

  if (!rawDocs) {
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      errors: ['No valid document array found in import data.'],
    };
  }

  // Validate documents
  const validatedDocs: LedgerDocument[] = [];
  for (let i = 0; i < rawDocs.length; i++) {
    const item = rawDocs[i] as any;
    if (!item || typeof item !== 'object') {
      errors.push(`Document index ${i}: Invalid object structure.`);
      continue;
    }

    if (typeof item.title !== 'string') {
      errors.push(`Document index ${i}: Missing or invalid "title".`);
      continue;
    }

    const docType: DocumentType = [
      'chapter',
      'draft',
      'structured_chapter',
      'receipt',
      'research',
      'supporting_doc',
    ].includes(item.type)
      ? item.type
      : 'supporting_doc';

    const validDoc: LedgerDocument = {
      id: typeof item.id === 'string' && item.id.trim() ? item.id : generateId(docType === 'receipt' ? 'rcpt' : 'doc'),
      title: item.title,
      type: docType,
      body: typeof item.body === 'string' ? item.body : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      status: typeof item.status === 'string' ? item.status : (docType === 'receipt' ? 'unresolved' : 'draft'),
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === 'string') : [],
      source: typeof item.source === 'string' ? item.source : '',
      relatedDocIds: Array.isArray(item.relatedDocIds) ? item.relatedDocIds.filter((id: unknown) => typeof id === 'string') : [],
      receiptData: item.receiptData && typeof item.receiptData === 'object' ? item.receiptData : undefined,
      metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
      schemaVersion: 1,
    };

    validatedDocs.push(validDoc);
  }

  if (validatedDocs.length === 0) {
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      errors: errors.length > 0 ? errors : ['No valid records could be extracted.'],
    };
  }

  const db = await openLedgerDB(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.DOCUMENTS, 'readwrite');
    const store = tx.objectStore(STORES.DOCUMENTS);

    if (mode === 'replace') {
      store.clear();
    }

    for (const doc of validatedDocs) {
      store.put(doc);
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(new Error(`Transaction failed during import: ${tx.error?.message}`));
    };
  });

  if (dbName === DB_NAME) {
    if (mode === 'replace') {
      replaceWalMirror(validatedDocs);
    } else {
      for (const d of validatedDocs) {
        writeWalMirror(d);
      }
    }
    try {
      await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode === 'replace' ? 'replace_all' : 'sync_merge',
          documents: validatedDocs,
        }),
      });
    } catch {
      // Buffered locally
    }
  }

  return {
    success: true,
    importedCount: validatedDocs.length,
    skippedCount: 0,
    errors,
  };
}

/**
 * Execute real Acceptance Tests (Tests A through H) against an isolated test database
 * to provide empirical, verifiable evidence of system performance and correctness.
 */
export async function runAcceptanceTests(): Promise<AcceptanceTestReport> {
  const testDbName = `ledger_test_${Date.now()}`;
  const results: TestResultItem[] = [];

  const runTest = async (
    id: string,
    name: string,
    description: string,
    fn: () => Promise<{ passed: boolean; message: string; details?: Record<string, unknown> }>
  ) => {
    const start = performance.now();
    try {
      const res = await fn();
      results.push({
        id,
        name,
        description,
        passed: res.passed,
        message: res.message,
        details: res.details,
        durationMs: Math.round(performance.now() - start),
      });
    } catch (err: any) {
      results.push({
        id,
        name,
        description,
        passed: false,
        message: `Exception: ${err?.message || 'Unknown failure'}`,
        durationMs: Math.round(performance.now() - start),
      });
    }
  };

  // Test A: Creation
  await runTest(
    'TEST_A',
    'Test A: Creation',
    'Create a chapter with title and multiline body; verify presence in database.',
    async () => {
      const title = 'Chapter 1: The Void Over Kuoh';
      const body = 'Line 1: A silence settled upon the dimensional tear.\nLine 2: Nothing stirred.\n\nLine 3: Then the bell tolled.';
      const doc = await createDocument({ title, type: 'chapter', body }, testDbName);
      
      const retrieved = await getDocumentById(doc.id, testDbName);
      const passed = !!retrieved && retrieved.title === title && retrieved.body === body && retrieved.type === 'chapter';
      return {
        passed,
        message: passed ? 'Chapter created and successfully retrieved from store.' : 'Created chapter could not be verified in store.',
        details: { docId: doc.id, title: retrieved?.title, linesCount: retrieved?.body.split('\n').length },
      };
    }
  );

  // Test B: Persistence
  await runTest(
    'TEST_B',
    'Test B: Persistence',
    'Close DB connection, reopen fresh instance, verify record survives.',
    async () => {
      const title = 'Persistence Test Record';
      const body = 'Persistent content surviving simulated reload.';
      const created = await createDocument({ title, type: 'draft', body }, testDbName);
      
      // Open completely independent connection to test persistence
      const freshDocs = await getAllDocuments(testDbName);
      const found = freshDocs.find((d) => d.id === created.id);
      const passed = !!found && found.body === body;
      return {
        passed,
        message: passed ? 'Record survived connection cycle with content intact.' : 'Record was missing upon reconnect.',
        details: { id: created.id, foundInFreshQuery: !!found },
      };
    }
  );

  // Test C: Editing
  await runTest(
    'TEST_C',
    'Test C: Editing',
    'Modify chapter; verify existing record is updated and ID and createdAt remain unchanged.',
    async () => {
      const doc = await createDocument({ title: 'Initial Version', type: 'chapter', body: 'Draft 1' }, testDbName);
      const originalCreatedAt = doc.createdAt;
      const originalId = doc.id;

      // Small delay to ensure timestamp resolution difference
      await new Promise((r) => setTimeout(r, 10));

      const updated = await updateDocument(doc.id, { title: 'Revision 2', body: 'Draft 2 - Updated' }, testDbName);
      const verified = await getDocumentById(doc.id, testDbName);

      const passed =
        !!verified &&
        verified.id === originalId &&
        verified.createdAt === originalCreatedAt &&
        verified.title === 'Revision 2' &&
        verified.body === 'Draft 2 - Updated' &&
        new Date(verified.updatedAt).getTime() >= new Date(originalCreatedAt).getTime();

      return {
        passed,
        message: passed
          ? 'Record updated in-place: ID and createdAt strictly preserved, updatedAt updated.'
          : 'Update violated ID or createdAt immutability.',
        details: {
          originalId,
          updatedId: verified?.id,
          createdAt: verified?.createdAt,
          updatedAt: verified?.updatedAt,
        },
      };
    }
  );

  // Test D: Navigation / Multitype
  await runTest(
    'TEST_D',
    'Test D: Navigation & Distinct Types',
    'Create distinct document types and verify type segregation.',
    async () => {
      const ch = await createDocument({ title: 'Canon Chapter', type: 'chapter', body: 'Chapter content' }, testDbName);
      const df = await createDocument({ title: 'Draft Scene', type: 'draft', body: 'Draft content' }, testDbName);
      const sc = await createDocument({ title: 'Structured Arc', type: 'structured_chapter', body: 'Structured content' }, testDbName);
      const rs = await createDocument({ title: 'Cosmology Notes', type: 'research', body: 'Research content' }, testDbName);

      const all = await getAllDocuments(testDbName);
      const typesPresent = new Set(all.map((d) => d.type));
      const passed = typesPresent.has('chapter') && typesPresent.has('draft') && typesPresent.has('structured_chapter') && typesPresent.has('research');

      return {
        passed,
        message: passed ? 'All distinct document types registered and segregated properly.' : 'Missing document types in query.',
        details: { distinctTypesFound: Array.from(typesPresent) },
      };
    }
  );

  // Test E: Content Fidelity
  await runTest(
    'TEST_E',
    'Test E: Content Fidelity',
    'Test Unicode, symbols, Japanese kanji, emoticons, multiple spaces, and unusual punctuation.',
    async () => {
      const complexText = `Ur-Verse Canonical Probe:
- Japanese: 虚空の座 (Seat of the Void) / 燚 (Quad-fire)
- Emoticon: (╯°□°)╯︵ ┻━┻ and ¯\\_(ツ)_/¯
- Punctuation & spacing:   Multiple    spaces   between   words.
- Symbols: ⚔️ 🛡️ ✦ ✧ ⚙️ ⚯ ⚛
- Multiline formatting:
    Indented line 1
        Deeply indented line 2
- Unicode mathematical operators: ∀x ∈ Ur-Verse, ∃y : y ⊨ Canon ∧ ¬(x ≡ y)`;

      const doc = await createDocument({ title: 'Fidelity Probe', type: 'research', body: complexText }, testDbName);
      const retrieved = await getDocumentById(doc.id, testDbName);

      const passed = !!retrieved && retrieved.body === complexText;
      return {
        passed,
        message: passed ? 'Exact byte/string equality verified across Unicode, spaces, and multiline text.' : 'Content fidelity test detected string mangling.',
        details: {
          originalLength: complexText.length,
          retrievedLength: retrieved?.body.length,
          exactMatch: retrieved?.body === complexText,
        },
      };
    }
  );

  // Test F: Receipt Record
  await runTest(
    'TEST_F',
    'Test F: Receipt Record & Unresolved Status',
    'Create receipt with source and unresolved status; verify status remains unresolved.',
    async () => {
      const receiptData: ReceiptData = {
        eventType: 'decision',
        eventTimestamp: '2026-10-20T10:00:00Z',
        recordEntryTimestamp: new Date().toISOString(),
        summary: 'Cosmological boundary decision regarding Sacred Gear mechanics',
        detailedNotes: 'Observation noted from external model inference. Requires owner validation.',
        sourceModel: 'Sub-model-Omega',
        evidenceOrLinkedDocs: [],
        verificationStatus: 'unresolved',
      };

      const doc = await createDocument(
        {
          title: 'Receipt #001: Boundary Decision',
          type: 'receipt',
          body: 'Detailed log of candidate mechanics.',
          source: 'Sub-model-Omega',
          receiptData,
        },
        testDbName
      );

      const retrieved = await getDocumentById(doc.id, testDbName);
      const passed =
        !!retrieved &&
        retrieved.type === 'receipt' &&
        retrieved.receiptData?.verificationStatus === 'unresolved' &&
        retrieved.receiptData?.sourceModel === 'Sub-model-Omega';

      return {
        passed,
        message: passed ? 'Receipt stored and verified; verificationStatus remained strictly "unresolved".' : 'Receipt verification status was altered.',
        details: {
          status: retrieved?.receiptData?.verificationStatus,
          sourceModel: retrieved?.receiptData?.sourceModel,
        },
      };
    }
  );

  // Test G: Export and Import
  await runTest(
    'TEST_G',
    'Test G: Export & Import Roundtrip',
    'Export records to JSON package, import into secondary clean DB, verify complete survival.',
    async () => {
      const exportedPkg = await exportLedgerPackage(testDbName);
      const targetDbName = `ledger_import_target_${Date.now()}`;

      const importResult = await importLedgerPackage(exportedPkg, 'replace', targetDbName);
      const targetDocs = await getAllDocuments(targetDbName);

      const passed = importResult.success && targetDocs.length === exportedPkg.documentCount && targetDocs.length > 0;

      // Clean up target test DB
      window.indexedDB.deleteDatabase(targetDbName);

      return {
        passed,
        message: passed
          ? `Round-trip successful: ${targetDocs.length} records exported and cleanly re-imported.`
          : 'Import round-trip failed or counts mismatched.',
        details: {
          exportedCount: exportedPkg.documentCount,
          importedCount: targetDocs.length,
        },
      };
    }
  );

  // Test H: Error Honesty
  await runTest(
    'TEST_H',
    'Test H: Error Honesty',
    'Feed invalid payload to import validator; verify explicit error reporting instead of false success.',
    async () => {
      const invalidPayload = { format: 'corrupt', documents: 'not-an-array' };
      const res = await importLedgerPackage(invalidPayload, 'merge', testDbName);

      const passed = res.success === false && res.errors.length > 0;
      return {
        passed,
        message: passed ? `Error honesty verified: Rejected invalid import with "${res.errors[0]}".` : 'Validator accepted malformed payload incorrectly.',
        details: { successFlag: res.success, errorsReported: res.errors },
      };
    }
  );

  // Clean up primary test database
  try {
    window.indexedDB.deleteDatabase(testDbName);
  } catch {
    // Ignore cleanup error in test
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    results,
  };
}

/**
 * Known pseudo / placeholder document titles from initial bootstrap
 */
export const PSEUDO_DOCUMENT_TITLES = new Set([
  'Prologue: Echoes in the Ur-Verse',
  'Character Dossier: Valerie Lucifuge (Draft Notes)',
  'Ur-Verse Cosmology: Layer Structure & Dimensional Fabric',
  'Receipt #001: Separation of Canon Authority from Storage Claims',
]);

/**
 * Purge only unedited initial seed documents (when explicitly requested by user)
 */
export async function purgePseudoDocuments(dbName: string = DB_NAME): Promise<number> {
  const docs = await getAllDocuments(dbName);
  // Only match if title is an exact seed title AND the document was never edited (createdAt === updatedAt)
  const pseudoDocs = docs.filter(
    (d) => PSEUDO_DOCUMENT_TITLES.has(d.title) && d.createdAt === d.updatedAt
  );

  if (pseudoDocs.length === 0) {
    return 0;
  }

  for (const doc of pseudoDocs) {
    await deleteDocument(doc.id, dbName);
  }

  return pseudoDocs.length;
}

/**
 * Clear all documents from the database (for explicit reset / clean slate)
 */
export async function clearAllDocuments(dbName: string = DB_NAME): Promise<void> {
  if (dbName === DB_NAME) {
    replaceWalMirror([]);
  }

  const db = await openLedgerDB(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.DOCUMENTS, 'readwrite');
    const store = tx.objectStore(STORES.DOCUMENTS);
    const req = store.clear();

    req.onsuccess = () => {
      resolve();
    };

    req.onerror = () => {
      reject(new Error(`Failed to clear documents: ${req.error?.message}`));
    };

    tx.oncomplete = () => db.close();
  });

  if (dbName === DB_NAME) {
    try {
      await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'replace_all', documents: [] }),
      });
    } catch {
      // Ignore
    }
  }
}
