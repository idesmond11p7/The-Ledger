'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LedgerDocument,
  DocumentType,
} from '@/lib/db/types';
import {
  getAllDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
} from '@/lib/db';
import { Sidebar, FilterCategory } from '@/components/Sidebar';
import { DocumentList } from '@/components/DocumentList';
import { DocumentEditor } from '@/components/DocumentEditor';
import { AcceptanceTestModal } from '@/components/AcceptanceTestModal';
import { ImportExportModal } from '@/components/ImportExportModal';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function LedgerHome() {
  const [documents, setDocuments] = useState<LedgerDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [currentCategory, setCurrentCategory] = useState<FilterCategory>('all');
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isImportExportOpen, setIsImportExportOpen] = useState(false);

  // Load and reconcile documents across Server Disk, IndexedDB, and WAL Mirror
  const refreshDocuments = useCallback(async (selectIdAfterLoad?: string) => {
    try {
      setErrorMessage(null);
      const docs = await getAllDocuments();
      setDocuments(docs);

      if (selectIdAfterLoad) {
        setSelectedDocId(selectIdAfterLoad);
      } else if (docs.length > 0 && !selectedDocId) {
        setSelectedDocId(docs[0].id);
      } else if (docs.length === 0) {
        setSelectedDocId(null);
      }
    } catch (err: any) {
      console.error('Failed to load documents:', err);
      setErrorMessage(`Storage Error: ${err.message || 'Could not access database'}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDocId]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const docs = await getAllDocuments();
        if (!active) return;
        setDocuments(docs);
        if (docs.length > 0) {
          setSelectedDocId(docs[0].id);
        }
      } catch (err: any) {
        if (!active) return;
        setErrorMessage(`Storage Error: ${err?.message || 'Could not access database'}`);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  // Active document object
  const activeDocument = useMemo(() => {
    return documents.find((d) => d.id === selectedDocId) || null;
  }, [documents, selectedDocId]);

  // Compute counts per category
  const counts = useMemo(() => {
    const res: Record<FilterCategory, number> = {
      all: documents.length,
      chapter: 0,
      draft: 0,
      structured_chapter: 0,
      receipt: 0,
      research: 0,
      supporting_doc: 0,
    };
    for (const d of documents) {
      if (res[d.type] !== undefined) {
        res[d.type]++;
      }
    }
    return res;
  }, [documents]);

  // Navigate between documents (DocumentEditor automatically flushes any pending edits on unmount)
  const handleSelectDoc = (id: string) => {
    if (id === selectedDocId) return;
    setIsDirty(false);
    setSelectedDocId(id);
  };

  const handleSelectCategory = (cat: FilterCategory) => {
    setCurrentCategory(cat);
  };

  // Create new document (DocumentEditor automatically flushes any pending edits on switch)
  const handleCreateNew = async (specificType?: DocumentType) => {
    try {
      const targetType = specificType || (currentCategory !== 'all' ? currentCategory : 'chapter');
      const isReceipt = targetType === 'receipt';

      const newDoc = await createDocument({
        title: isReceipt ? 'New Receipt' : `New ${targetType.replace('_', ' ')}`,
        type: targetType,
        body: '',
        status: isReceipt ? 'unresolved' : 'draft',
        source: '',
        tags: [],
        receiptData: isReceipt
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
          : undefined,
      });

      setIsDirty(false);
      setDocuments((prev) => [newDoc, ...prev.filter((d) => d.id !== newDoc.id)]);
      setSelectedDocId(newDoc.id);
    } catch (err: any) {
      setErrorMessage(`Creation failed: ${err.message}`);
    }
  };

  // Immediate in-memory state update on every keystroke so switching or creating documents never sees stale state
  const handleLiveChange = useCallback((updatedDoc: LedgerDocument) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === updatedDoc.id ? updatedDoc : d))
    );
  }, []);

  // Save document handler
  const handleSaveDocument = async (updatedDoc: LedgerDocument) => {
    try {
      const saved = await updateDocument(updatedDoc.id, {
        title: updatedDoc.title,
        type: updatedDoc.type,
        body: updatedDoc.body,
        status: updatedDoc.status,
        tags: updatedDoc.tags,
        source: updatedDoc.source,
        relatedDocIds: updatedDoc.relatedDocIds,
        receiptData: updatedDoc.receiptData,
        metadata: updatedDoc.metadata,
        createdAt: updatedDoc.createdAt,
      });

      // Update in local document list while preserving immutable createdAt
      setDocuments((prev) => {
        const exists = prev.some((d) => d.id === saved.id);
        if (!exists) return [saved, ...prev];
        return prev.map((d) => (d.id === saved.id ? saved : d));
      });
    } catch (err: any) {
      console.error('Save error:', err);
      throw err;
    }
  };

  // Delete document handler
  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteDocument(id);
      setIsDirty(false);
      const remaining = documents.filter((d) => d.id !== id);
      setDocuments(remaining);
      setSelectedDocId(remaining.length > 0 ? remaining[0].id : null);
    } catch (err: any) {
      setErrorMessage(`Deletion failed: ${err.message}`);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 font-sans text-neutral-100 antialiased">
      {/* Sidebar: Navigation & Controls */}
      <Sidebar
        currentCategory={currentCategory}
        onSelectCategory={handleSelectCategory}
        onCreateNew={handleCreateNew}
        onOpenTestModal={() => setIsTestModalOpen(true)}
        onOpenImportExport={() => setIsImportExportOpen(true)}
        counts={counts}
      />

      {/* Secondary Pane: Document List / Index */}
      <DocumentList
        documents={documents}
        currentCategory={currentCategory}
        selectedDocId={selectedDocId}
        onSelectDoc={handleSelectDoc}
        onCreateNew={handleCreateNew}
      />

      {/* Main Pane: Document Editor & Reader */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-900">
        {errorMessage && (
          <div className="p-3 bg-rose-950/80 border-b border-rose-800 text-rose-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => refreshDocuments()}
              className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700 text-neutral-200 text-[11px]"
            >
              Retry
            </button>
          </div>
        )}

        {isLoading && documents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400 gap-2 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Connecting to Persistent Ledger Store...</span>
          </div>
        ) : (
          <DocumentEditor
            key={activeDocument ? activeDocument.id : 'empty'}
            doc={activeDocument}
            allDocuments={documents}
            onSave={handleSaveDocument}
            onLiveChange={handleLiveChange}
            onDelete={handleDeleteDocument}
            isDirty={isDirty}
            setIsDirty={setIsDirty}
          />
        )}
      </main>

      {/* Acceptance Tests Modal (Tests A through H) */}
      <AcceptanceTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />

      {/* Data Portability (Import & Export) Modal */}
      <ImportExportModal
        isOpen={isImportExportOpen}
        onClose={() => setIsImportExportOpen(false)}
        onDataChanged={() => refreshDocuments(selectedDocId || undefined)}
      />
    </div>
  );
}
