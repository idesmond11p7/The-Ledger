'use client';

import React from 'react';
import { DocumentType } from '@/lib/db/types';
import {
  BookOpen,
  FileText,
  FileEdit,
  FolderTree,
  Receipt,
  Search,
  Paperclip,
  Plus,
  Database,
  ShieldCheck,
  ArrowDownUp,
} from 'lucide-react';

export type FilterCategory = 'all' | DocumentType;

interface SidebarProps {
  currentCategory: FilterCategory;
  onSelectCategory: (cat: FilterCategory) => void;
  onCreateNew: (type?: DocumentType) => void;
  onOpenTestModal: () => void;
  onOpenImportExport: () => void;
  counts: Record<FilterCategory, number>;
}

export function Sidebar({
  currentCategory,
  onSelectCategory,
  onCreateNew,
  onOpenTestModal,
  onOpenImportExport,
  counts,
}: SidebarProps) {
  const navItems: { id: FilterCategory; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Documents', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'chapter', label: 'Chapters', icon: <FileText className="w-4 h-4" /> },
    { id: 'draft', label: 'Drafts', icon: <FileEdit className="w-4 h-4" /> },
    { id: 'structured_chapter', label: 'Structured Chapters', icon: <FolderTree className="w-4 h-4" /> },
    { id: 'receipt', label: 'Receipts', icon: <Receipt className="w-4 h-4" /> },
    { id: 'research', label: 'Research Records', icon: <Search className="w-4 h-4" /> },
    { id: 'supporting_doc', label: 'Supporting Documents', icon: <Paperclip className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col h-full select-none text-neutral-300">
      {/* Brand Header */}
      <div className="p-4 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center text-white font-bold text-xs tracking-wider">
            TL
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-neutral-100">The Ledger</h1>
            <p className="text-[10px] text-neutral-400 truncate max-w-[170px]" title="Apocrypha DXD: ForeverWorlds">
              Apocrypha DXD: ForeverWorlds
            </p>
          </div>
        </div>

        {/* Create Document Button */}
        <button
          onClick={() => onCreateNew()}
          className="mt-3.5 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium shadow-xs transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Document</span>
        </button>
      </div>

      {/* Navigation Filter List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Library Categories
        </div>
        {navItems.map((item) => {
          const isActive = currentCategory === item.id;
          const count = counts[item.id] || 0;

          return (
            <button
              key={item.id}
              onClick={() => onSelectCategory(item.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition ${
                isActive
                  ? 'bg-neutral-800 text-neutral-100 font-medium'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={isActive ? 'text-indigo-400' : 'text-neutral-500'}>{item.icon}</span>
                <span>{item.label}</span>
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  isActive ? 'bg-neutral-700 text-neutral-200' : 'text-neutral-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* System Status & Diagnostics Footer */}
      <div className="p-3 border-t border-neutral-800 bg-neutral-950/60 space-y-2">
        {/* Persistence Status */}
        <div className="flex items-center justify-between px-1.5 py-1 text-[11px] text-neutral-400">
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>Disk + IndexedDB</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Synced v1
          </span>
        </div>

        {/* Verification & Backup tools */}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            onClick={onOpenTestModal}
            title="Run Acceptance Tests A-H on real storage"
            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] transition"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>Verify (A–H)</span>
          </button>
          <button
            onClick={onOpenImportExport}
            title="Import or Export Ledger records"
            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] transition"
          >
            <ArrowDownUp className="w-3.5 h-3.5 text-neutral-400" />
            <span>Portability</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
