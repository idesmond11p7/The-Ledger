/**
 * The Ledger - Data Model & Type Definitions
 * Version: 1.0.0
 * 
 * Epistemic principle: Storing a record does not make it true.
 * Provenance, event times, and verification status are strictly tracked.
 */

export type DocumentType =
  | 'chapter'
  | 'draft'
  | 'structured_chapter'
  | 'receipt'
  | 'research'
  | 'supporting_doc';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  chapter: 'Chapter',
  draft: 'Draft',
  structured_chapter: 'Structured Chapter',
  receipt: 'Receipt',
  research: 'Research Record',
  supporting_doc: 'Supporting Document',
};

export type VerificationStatus =
  | 'unresolved'
  | 'reported'
  | 'inferred'
  | 'user_decision'
  | 'confirmed'
  | 'superseded';

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, { label: string; description: string }> = {
  unresolved: {
    label: 'Unresolved',
    description: 'Unknown or unverified. Status cannot currently be established.',
  },
  reported: {
    label: 'Reported',
    description: 'Supplied by an external model, source, or record without independent confirmation.',
  },
  inferred: {
    label: 'Inferred',
    description: 'Plausible interpretation or deduction that remains unconfirmed by canon authority.',
  },
  user_decision: {
    label: 'User Decision',
    description: 'Explicit creative choice or instruction enacted by the project owner.',
  },
  confirmed: {
    label: 'Confirmed',
    description: 'Verified against primary evidence or canon authority.',
  },
  superseded: {
    label: 'Superseded',
    description: 'Replaced or revised by a later decision or updated canon record.',
  },
};

export type ReceiptEventType =
  | 'decision'
  | 'observation'
  | 'action'
  | 'failure'
  | 'correction'
  | 'verification'
  | 'lore_claim'
  | 'custom';

export interface ReceiptData {
  eventType: ReceiptEventType;
  eventTimestamp: string | null; // ISO string if known, null if unknown
  recordEntryTimestamp: string; // When recorded in Ledger
  summary: string;
  detailedNotes: string;
  sourceModel: string; // Originating model, human, or reference
  evidenceOrLinkedDocs: string[];
  verificationStatus: VerificationStatus;
}

export interface LedgerDocument {
  id: string; // Stable unique identifier
  title: string;
  type: DocumentType;
  body: string; // Raw text content, strictly preserving unicode, line breaks, whitespace
  createdAt: string; // Immutable ISO timestamp
  updatedAt: string; // Last modified ISO timestamp
  status: string; // Workflow status (e.g., 'draft', 'in_progress', 'ready', 'archived')
  tags: string[];
  source: string; // Provenance / origin notes
  relatedDocIds: string[]; // Relational links to other records
  receiptData?: ReceiptData; // Populated when type is 'receipt'
  metadata: Record<string, unknown>; // Extensible key-value metadata
  schemaVersion: number; // Currently 1
}

export interface AttachmentRecord {
  id: string;
  docId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerExportPackage {
  format: 'ledger_backup';
  schemaVersion: number;
  exportedAt: string;
  app: string;
  documentCount: number;
  documents: LedgerDocument[];
}

export interface TestResultItem {
  id: string;
  name: string;
  description: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
  durationMs: number;
}

export interface AcceptanceTestReport {
  timestamp: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  results: TestResultItem[];
}
