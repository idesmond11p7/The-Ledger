'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LedgerDocument,
  DocumentType,
  ReceiptData,
  VerificationStatus,
  DOCUMENT_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/lib/db/types';
import { writeWalMirror } from '@/lib/db';
import {
  Save,
  Trash2,
  Download,
  Link as LinkIcon,
  Tag,
  Clock,
  ShieldAlert,
  Info,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface DocumentEditorProps {
  doc: LedgerDocument | null;
  allDocuments: LedgerDocument[];
  onSave: (doc: LedgerDocument) => Promise<void>;
  onLiveChange?: (doc: LedgerDocument) => void;
  onDelete: (id: string) => Promise<void>;
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
}

export function DocumentEditor({
  doc,
  allDocuments,
  onSave,
  onLiveChange,
  onDelete,
  isDirty,
  setIsDirty,
}: DocumentEditorProps) {
  // Local edit states initialized directly from doc prop (Component is keyed by doc.id)
  const [title, setTitle] = useState(doc?.title ?? '');
  const [type, setType] = useState<DocumentType>(doc?.type ?? 'chapter');
  const [body, setBody] = useState(doc?.body ?? '');
  const [status, setStatus] = useState(doc?.status ?? 'draft');
  const [tagsInput, setTagsInput] = useState(doc?.tags ? doc.tags.join(', ') : '');
  const [source, setSource] = useState(doc?.source ?? '');
  const [relatedDocIds, setRelatedDocIds] = useState<string[]>(doc?.relatedDocIds ?? []);
  const [receiptData, setReceiptData] = useState<ReceiptData | undefined>(
    doc?.receiptData ||
      (doc?.type === 'receipt'
        ? {
            eventType: 'observation',
            eventTimestamp: null,
            recordEntryTimestamp: new Date().toISOString(),
            summary: '',
            detailedNotes: '',
            sourceModel: '',
            evidenceOrLinkedDocs: [],
            verificationStatus: 'unresolved',
          }
        : undefined)
  );

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refs for flush-on-unmount and synchronous WAL protection
  const isDirtyRef = useRef(false);
  const latestSnapshotRef = useRef<LedgerDocument | null>(doc);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const buildSnapshot = useCallback(
    (overrides?: {
      title?: string;
      type?: DocumentType;
      body?: string;
      status?: string;
      tagsInput?: string;
      source?: string;
      relatedDocIds?: string[];
      receiptData?: ReceiptData;
    }): LedgerDocument | null => {
      if (!doc) return null;
      const nextTitle = overrides?.title !== undefined ? overrides.title : title;
      const nextType = overrides?.type !== undefined ? overrides.type : type;
      const nextBody = overrides?.body !== undefined ? overrides.body : body;
      const nextStatus = overrides?.status !== undefined ? overrides.status : status;
      const nextTagsInput = overrides?.tagsInput !== undefined ? overrides.tagsInput : tagsInput;
      const nextSource = overrides?.source !== undefined ? overrides.source : source;
      const nextRelated = overrides?.relatedDocIds !== undefined ? overrides.relatedDocIds : relatedDocIds;
      const nextReceipt = overrides?.receiptData !== undefined ? overrides.receiptData : receiptData;

      const parsedTags = nextTagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      return {
        ...doc,
        title: nextTitle.trim() || 'Untitled Document',
        type: nextType,
        body: nextBody, // Preserves exact whitespace and Unicode
        status: nextStatus,
        tags: parsedTags,
        source: nextSource.trim(),
        relatedDocIds: nextRelated,
        receiptData: nextType === 'receipt' ? nextReceipt : undefined,
        createdAt: doc.createdAt,
        updatedAt: new Date().toISOString(),
      };
    },
    [doc, title, type, body, status, tagsInput, source, relatedDocIds, receiptData]
  );

  // Synchronously commit every edit to the WAL mirror, parent state, and mark dirty for debounced IndexedDB + Server Disk save
  const recordEdit = useCallback(
    (overrides?: Parameters<typeof buildSnapshot>[0]) => {
      const snap = buildSnapshot(overrides);
      if (snap) {
        latestSnapshotRef.current = snap;
        writeWalMirror(snap);
        if (onLiveChange) {
          onLiveChange(snap);
        }
      }
      isDirtyRef.current = true;
      setIsDirty(true);
    },
    [buildSnapshot, onLiveChange, setIsDirty]
  );

  const handleTitleChange = (val: string) => {
    setTitle(val);
    recordEdit({ title: val });
  };

  const handleBodyChange = (val: string) => {
    setBody(val);
    recordEdit({ body: val });
  };

  const handleTypeChange = (newType: DocumentType) => {
    setType(newType);
    let nextReceipt = receiptData;
    if (newType === 'receipt' && !receiptData) {
      nextReceipt = {
        eventType: 'observation',
        eventTimestamp: null,
        recordEntryTimestamp: new Date().toISOString(),
        summary: '',
        detailedNotes: '',
        sourceModel: '',
        evidenceOrLinkedDocs: [],
        verificationStatus: 'unresolved',
      };
      setReceiptData(nextReceipt);
    }
    recordEdit({ type: newType, receiptData: nextReceipt });
  };

  const handleReceiptChange = (updates: Partial<ReceiptData>) => {
    const base: ReceiptData = receiptData || {
      eventType: 'observation',
      eventTimestamp: null,
      recordEntryTimestamp: new Date().toISOString(),
      summary: '',
      detailedNotes: '',
      sourceModel: '',
      evidenceOrLinkedDocs: [],
      verificationStatus: 'unresolved',
    };
    const nextReceipt = { ...base, ...updates };
    setReceiptData(nextReceipt);
    recordEdit({ receiptData: nextReceipt });
  };

  const handleSave = useCallback(async () => {
    const snap = buildSnapshot();
    if (!snap) return;
    latestSnapshotRef.current = snap;
    writeWalMirror(snap);
    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave(snap);
      isDirtyRef.current = false;
      setIsDirty(false);
      setSaveSuccessNotice(true);
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [buildSnapshot, onSave, setIsDirty]);

  // Automatic debounced save (350ms after typing) so work is continuously persisted
  useEffect(() => {
    if (!isDirty || !doc) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 350);
    return () => clearTimeout(timer);
  }, [isDirty, doc, title, type, body, status, tagsInput, source, relatedDocIds, receiptData, handleSave]);

  // Flush any pending unsaved changes on unmount, visibilitychange, pagehide, or beforeunload
  useEffect(() => {
    const flushNow = () => {
      if (isDirtyRef.current && latestSnapshotRef.current) {
        const snap = latestSnapshotRef.current;
        writeWalMirror(snap);
        onSaveRef.current(snap).catch(() => {});
        try {
          fetch('/api/ledger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'upsert', document: snap }),
            keepalive: true,
          }).catch(() => {});
        } catch {
          // Ignore
        }
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        flushNow();
        e.preventDefault();
        e.returnValue = '';
      }
    };

    const handleVisibilityChange = () => {
      if (window.document.visibilityState === 'hidden') {
        flushNow();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', flushNow);
    window.document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', flushNow);
      window.document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushNow();
    };
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const handleExportSingle = () => {
    if (!doc) return;
    const content = `---
Title: ${title}
Type: ${type}
ID: ${doc.id}
Created: ${doc.createdAt}
Updated: ${doc.updatedAt}
Source: ${source}
Tags: ${tagsInput}
---

${body}`;

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'document'}.md`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!doc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-neutral-900 text-neutral-500 p-8 select-none">
        <Info className="w-12 h-12 mb-3 text-neutral-700" />
        <h3 className="text-sm font-medium text-neutral-400">No Document Selected</h3>
        <p className="text-xs text-neutral-600 mt-1 max-w-sm text-center">
          Select an entry from the library index on the left or create a new document to begin editing.
        </p>
      </div>
    );
  }

  // Calculate text metrics
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const charCount = body.length;
  const lineCount = body ? body.split('\n').length : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-900 overflow-hidden text-neutral-200">
      {/* Top Toolbar */}
      <div className="border-b border-neutral-800 bg-neutral-900/90 px-6 py-3 flex items-center justify-between gap-4">
        {/* Document Type Selector & Status */}
        <div className="flex items-center gap-3">
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as DocumentType)}
            className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs rounded px-2.5 py-1 font-medium focus:outline-hidden focus:border-indigo-500"
          >
            {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          {/* Persistence status indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            {saveError ? (
              <span className="text-rose-400 flex items-center gap-1 font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                {saveError}
              </span>
            ) : isSaving ? (
              <span className="text-amber-400 flex items-center gap-1 font-mono text-[11px]">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                Syncing to Disk & IndexedDB...
              </span>
            ) : isDirty ? (
              <span className="text-amber-400/90 flex items-center gap-1 font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Buffered in WAL (Auto-saving...)
              </span>
            ) : saveSuccessNotice ? (
              <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px]">
                <Check className="w-3.5 h-3.5" />
                Persisted (Disk + IndexedDB)
              </span>
            ) : (
              <span className="text-neutral-500 flex items-center gap-1 font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                Persisted (Disk + IndexedDB)
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMetadataPanel(!showMetadataPanel)}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition ${
              showMetadataPanel
                ? 'bg-neutral-800 border-neutral-600 text-neutral-100'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>Record Details</span>
            {showMetadataPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleExportSingle}
            title="Export as Markdown"
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded border border-neutral-800 transition"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete Document"
            className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded border border-neutral-800 transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition shadow-xs ${
              isDirty
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Now'}</span>
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="bg-rose-950/40 border-b border-rose-900/60 p-3 px-6 flex items-center justify-between text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Permanently delete &ldquo;{title || 'Untitled'}&rdquo; from storage?</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-2.5 py-1 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              onClick={() => onDelete(doc.id)}
              className="px-2.5 py-1 rounded bg-rose-600 text-white hover:bg-rose-500 font-medium"
            >
              Confirm Deletion
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Record Metadata & Provenance Drawer */}
      {showMetadataPanel && (
        <div className="border-b border-neutral-800 bg-neutral-950/90 p-4 px-6 text-xs space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-neutral-400">
            <div>
              <span className="block text-[10px] uppercase font-mono text-neutral-500">Record ID</span>
              <span className="font-mono text-neutral-300 select-all">{doc.id}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-mono text-neutral-500">Created At</span>
              <span className="font-mono text-neutral-300">
                {new Date(doc.createdAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-mono text-neutral-500">Last Modified</span>
              <span className="font-mono text-neutral-300">
                {new Date(doc.updatedAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-mono text-neutral-500">Schema Version</span>
              <span className="font-mono text-neutral-300">v{doc.schemaVersion}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Source / Provenance:</label>
              <input
                type="text"
                value={source}
                onChange={(e) => {
                  const val = e.target.value;
                  setSource(val);
                  recordEdit({ source: val });
                }}
                placeholder="e.g., Session 14, Opus-4, Canon Note"
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Tags (comma-separated):</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setTagsInput(val);
                  recordEdit({ tagsInput: val });
                }}
                placeholder="e.g., Ur-Verse, Issei, Magic-System"
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Document Status:</label>
              <input
                type="text"
                value={status}
                onChange={(e) => {
                  const val = e.target.value;
                  setStatus(val);
                  recordEdit({ status: val });
                }}
                placeholder="e.g., draft, in_progress, canonized"
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Relational Links */}
          <div className="pt-1">
            <label className="block text-[11px] text-neutral-400 mb-1 flex items-center gap-1.5">
              <LinkIcon className="w-3 h-3 text-neutral-500" />
              <span>Link Related Documents:</span>
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 bg-neutral-900 rounded border border-neutral-800">
              {allDocuments
                .filter((d) => d.id !== doc.id)
                .map((d) => {
                  const isLinked = relatedDocIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        const next = isLinked
                          ? relatedDocIds.filter((id) => id !== d.id)
                          : [...relatedDocIds, d.id];
                        setRelatedDocIds(next);
                        recordEdit({ relatedDocIds: next });
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] transition ${
                        isLinked
                          ? 'bg-indigo-900/60 text-indigo-200 border border-indigo-700'
                          : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {isLinked ? '✓ ' : '+ '}
                      {d.title || 'Untitled'}
                    </button>
                  );
                })}
              {allDocuments.length <= 1 && (
                <span className="text-[11px] text-neutral-500 italic">No other documents to link.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Specialized Receipt Inspector (Active when document is type: receipt) */}
      {type === 'receipt' && (
        <div className="border-b border-neutral-800 bg-neutral-950/70 p-4 px-6 text-xs space-y-3">
          <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs pb-1">
            <ShieldAlert className="w-4 h-4" />
            <span>Receipt Provenance Record</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Event Type:</label>
              <select
                value={receiptData?.eventType || 'observation'}
                onChange={(e) => handleReceiptChange({ eventType: e.target.value as any })}
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="decision">Decision</option>
                <option value="observation">Observation</option>
                <option value="action">Action</option>
                <option value="failure">Failure</option>
                <option value="correction">Correction</option>
                <option value="verification">Verification</option>
                <option value="lore_claim">Lore Claim</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">
                Verification Status:
              </label>
              <select
                value={receiptData?.verificationStatus || 'unresolved'}
                onChange={(e) => handleReceiptChange({ verificationStatus: e.target.value as VerificationStatus })}
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500 font-mono"
              >
                {(Object.keys(VERIFICATION_STATUS_LABELS) as VerificationStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {VERIFICATION_STATUS_LABELS[st].label} ({st})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Originating Model / Author:</label>
              <input
                type="text"
                value={receiptData?.sourceModel || ''}
                onChange={(e) => handleReceiptChange({ sourceModel: e.target.value })}
                placeholder="e.g., Sub-model-Beta or Project Owner"
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-neutral-400 mb-1">Summary Statement:</label>
            <input
              type="text"
              value={receiptData?.summary || ''}
              onChange={(e) => handleReceiptChange({ summary: e.target.value })}
              placeholder="Concise summary of the event or decision"
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-hidden focus:border-indigo-500"
            />
          </div>
        </div>
      )}

      {/* Document Title Input */}
      <div className="px-6 pt-4 pb-2">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Document Title..."
          className="w-full bg-transparent text-xl font-bold tracking-tight text-neutral-100 placeholder:text-neutral-600 focus:outline-hidden"
        />
      </div>

      {/* Raw Body Text Editor (High Fidelity, strictly preserving Unicode, spacing, formatting) */}
      <div className="flex-1 px-6 pb-4 flex flex-col min-h-0">
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Enter raw text here... All Unicode, symbols, emoticons, multiple spaces, and line breaks are strictly preserved."
          className="w-full flex-1 bg-neutral-950 border border-neutral-800 rounded-md p-4 text-xs font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-hidden focus:border-neutral-700 resize-none leading-relaxed overflow-y-auto selection:bg-indigo-700 selection:text-white"
          spellCheck={false}
        />
      </div>

      {/* Editor Status Bar */}
      <div className="px-6 py-2 border-t border-neutral-800 bg-neutral-950 text-[11px] text-neutral-500 flex items-center justify-between font-mono">
        <div className="flex items-center gap-4">
          <span>{wordCount} words</span>
          <span>{charCount} characters</span>
          <span>{lineCount} lines</span>
        </div>
        <div className="flex items-center gap-2">
          <span>UTF-8 Verbatim</span>
          <span>•</span>
          <span>Ctrl/Cmd+S to save</span>
        </div>
      </div>
    </div>
  );
}
