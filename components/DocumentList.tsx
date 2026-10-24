'use client';

import React, { useState, useMemo } from 'react';
import { LedgerDocument, DocumentType, DOCUMENT_TYPE_LABELS, VERIFICATION_STATUS_LABELS } from '@/lib/db/types';
import { FilterCategory } from './Sidebar';
import { Search, Plus, Calendar, Tag, FileText, Receipt, ShieldQuestion, CheckCircle2 } from 'lucide-react';

interface DocumentListProps {
  documents: LedgerDocument[];
  currentCategory: FilterCategory;
  selectedDocId: string | null;
  onSelectDoc: (id: string) => void;
  onCreateNew: (type?: DocumentType) => void;
}

export function DocumentList({
  documents,
  currentCategory,
  selectedDocId,
  onSelectDoc,
  onCreateNew,
}: DocumentListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter by category and search query
  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      // Category filter
      if (currentCategory !== 'all' && doc.type !== currentCategory) {
        return false;
      }

      // Search filter
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      const inTitle = doc.title.toLowerCase().includes(q);
      const inBody = doc.body.toLowerCase().includes(q);
      const inSource = doc.source.toLowerCase().includes(q);
      const inTags = doc.tags.some((t) => t.toLowerCase().includes(q));

      return inTitle || inBody || inSource || inTags;
    });
  }, [documents, currentCategory, searchQuery]);

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const getCategoryTitle = () => {
    if (currentCategory === 'all') return 'All Documents';
    return DOCUMENT_TYPE_LABELS[currentCategory as DocumentType] || currentCategory;
  };

  return (
    <div className="w-80 bg-neutral-950 border-r border-neutral-800 flex flex-col h-full select-none text-neutral-300">
      {/* Header & Search */}
      <div className="p-3.5 border-b border-neutral-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {getCategoryTitle()}
          </h2>
          <span className="text-[11px] font-mono text-neutral-500">
            {filteredDocs.length} of {documents.length}
          </span>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles, text, tags..."
            className="w-full pl-8 pr-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-hidden focus:border-indigo-500 transition"
          />
        </div>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-900">
        {filteredDocs.length === 0 ? (
          <div className="p-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-neutral-900 flex items-center justify-center mx-auto text-neutral-600">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-neutral-400">No documents found</p>
              <p className="text-[11px] text-neutral-500 mt-1">
                {searchQuery ? 'Try clearing your search query.' : 'Create a new record in this category.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => onCreateNew(currentCategory === 'all' ? 'chapter' : (currentCategory as DocumentType))}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Document</span>
              </button>
            </div>
          </div>
        ) : (
          filteredDocs.map((doc) => {
            const isSelected = doc.id === selectedDocId;
            const isReceipt = doc.type === 'receipt';
            const verificationStatus = doc.receiptData?.verificationStatus || 'unresolved';

            return (
              <button
                key={doc.id}
                onClick={() => onSelectDoc(doc.id)}
                className={`w-full text-left p-3.5 transition flex flex-col gap-1.5 ${
                  isSelected
                    ? 'bg-neutral-900/90 border-l-2 border-indigo-500 text-neutral-100'
                    : 'hover:bg-neutral-900/40 text-neutral-300'
                }`}
              >
                {/* Title & Badge */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold leading-tight line-clamp-1 text-neutral-100">
                    {doc.title || 'Untitled Document'}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 ${
                      doc.type === 'chapter'
                        ? 'bg-sky-950/70 text-sky-400 border border-sky-800/40'
                        : doc.type === 'draft'
                        ? 'bg-amber-950/70 text-amber-400 border border-amber-800/40'
                        : doc.type === 'receipt'
                        ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/40'
                        : doc.type === 'research'
                        ? 'bg-purple-950/70 text-purple-400 border border-purple-800/40'
                        : 'bg-neutral-800 text-neutral-300'
                    }`}
                  >
                    {DOCUMENT_TYPE_LABELS[doc.type] || doc.type}
                  </span>
                </div>

                {/* Excerpt */}
                <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                  {doc.body ? doc.body.slice(0, 140) : '<Empty document body>'}
                </p>

                {/* Metadata Row */}
                <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-1">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-neutral-600" />
                    <span>{formatDate(doc.updatedAt)}</span>
                  </div>

                  {isReceipt && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-mono ${
                        verificationStatus === 'confirmed'
                          ? 'bg-emerald-950 text-emerald-300'
                          : verificationStatus === 'user_decision'
                          ? 'bg-indigo-950 text-indigo-300'
                          : verificationStatus === 'reported'
                          ? 'bg-amber-950 text-amber-300'
                          : 'bg-neutral-800 text-neutral-400'
                      }`}
                      title={VERIFICATION_STATUS_LABELS[verificationStatus]?.description}
                    >
                      {verificationStatus}
                    </span>
                  )}

                  {!isReceipt && doc.tags.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-neutral-500 truncate max-w-[120px]">
                      <Tag className="w-3 h-3 text-neutral-600" />
                      <span className="truncate">{doc.tags.join(', ')}</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
