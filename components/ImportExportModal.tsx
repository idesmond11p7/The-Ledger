'use client';

import React, { useState } from 'react';
import { exportLedgerPackage, importLedgerPackage, clearAllDocuments, purgePseudoDocuments } from '@/lib/db';
import { Download, Upload, Copy, Check, AlertCircle, FileJson, X, RefreshCw, Trash2, Eraser } from 'lucide-react';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged: () => void;
}

export function ImportExportModal({ isOpen, onClose, onDataChanged }: ImportExportModalProps) {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = useState<{
    success?: boolean;
    message?: string;
    errors?: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleExportDownload = async () => {
    try {
      const data = await exportLedgerPackage();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleExportCopy = async () => {
    try {
      const data = await exportLedgerPackage();
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err: any) {
      alert(`Copy failed: ${err.message}`);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportText(content);
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (!importText.trim()) {
      setImportStatus({
        success: false,
        message: 'Import payload is empty. Paste JSON or upload a file.',
      });
      return;
    }

    setIsLoading(true);
    setImportStatus(null);

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(importText);
      } catch (jsonErr: any) {
        setImportStatus({
          success: false,
          message: 'JSON Parse Failure: The provided payload is not valid JSON.',
          errors: [jsonErr.message],
        });
        setIsLoading(false);
        return;
      }

      const res = await importLedgerPackage(parsed, importMode);

      if (res.success) {
        setImportStatus({
          success: true,
          message: `Successfully imported ${res.importedCount} record(s) (${importMode === 'replace' ? 'replaced previous store' : 'merged with existing'}).`,
          errors: res.errors.length > 0 ? res.errors : undefined,
        });
        onDataChanged();
      } else {
        setImportStatus({
          success: false,
          message: 'Import validation failed.',
          errors: res.errors,
        });
      }
    } catch (err: any) {
      setImportStatus({
        success: false,
        message: 'Unexpected error during import operation.',
        errors: [err.message],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurgePseudoDocs = async () => {
    try {
      const purged = await purgePseudoDocuments();
      onDataChanged();
      alert(purged > 0 ? `Purged ${purged} pseudo document(s) from store.` : 'No pseudo documents found in storage.');
    } catch (err: any) {
      alert(`Purge failed: ${err.message}`);
    }
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm(
      'Are you absolutely sure you want to delete ALL documents from IndexedDB? This action is irreversible.'
    );
    if (!confirmed) return;

    try {
      await clearAllDocuments();
      onDataChanged();
      alert('All documents cleared from library.');
    } catch (err: any) {
      alert(`Clear failed: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-neutral-900 border border-neutral-700 text-neutral-100 rounded-lg shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-neutral-100">
              Data Portability: Import / Export
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-100 rounded-md hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex border-b border-neutral-800 px-6 bg-neutral-950">
          <button
            onClick={() => setTab('export')}
            className={`py-3 px-4 text-xs font-medium border-b-2 transition ${
              tab === 'export'
                ? 'border-indigo-500 text-neutral-100'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Export Backup
          </button>
          <button
            onClick={() => setTab('import')}
            className={`py-3 px-4 text-xs font-medium border-b-2 transition ${
              tab === 'import'
                ? 'border-indigo-500 text-neutral-100'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Import Data
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {tab === 'export' ? (
            <div className="space-y-4">
              <p className="text-xs text-neutral-300 leading-relaxed">
                Export compiles your complete library into a portable, versioned JSON backup format
                including all document records, immutable creation timestamps, tags, and receipt provenance.
              </p>

              <div className="bg-neutral-950 p-4 rounded border border-neutral-800 space-y-3">
                <div className="text-xs text-neutral-400">
                  <span className="text-neutral-200 font-medium">Backup Specification:</span>
                  <ul className="list-disc list-inside mt-1 space-y-1 text-neutral-400">
                    <li>Format: Standard Ledger JSON (`ledger_backup`, schema v1)</li>
                    <li>Scope: Chapters, Drafts, Structured Chapters, Receipts, Research, Supporting Docs</li>
                    <li>Target: Local filesystem storage / long-term cold backup</li>
                  </ul>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleExportDownload}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Backup File (.json)
                  </button>
                  <button
                    onClick={handleExportCopy}
                    className="flex items-center gap-1.5 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs font-medium transition"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied to Clipboard' : 'Copy JSON to Clipboard'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-neutral-300 leading-relaxed">
                Import JSON backup data into IndexedDB. Data is validated against the schema before committing.
              </p>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Import File:
                </label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileSelect}
                  className="block w-full text-xs text-neutral-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-neutral-800 file:text-neutral-200 hover:file:bg-neutral-700 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Or Paste JSON Payload:
                </label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste ledger backup JSON here..."
                  rows={6}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 text-xs font-mono text-neutral-200 focus:outline-hidden focus:border-indigo-500 placeholder:text-neutral-600 resize-y"
                />
              </div>

              {/* Import Mode */}
              <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 space-y-2">
                <span className="text-xs font-medium text-neutral-200 block">Commit Strategy:</span>
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="text-indigo-600 focus:ring-0"
                    />
                    <span className="text-neutral-300">
                      <strong>Merge & Update</strong> (Preserves records not in import)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="text-rose-500 focus:ring-0"
                    />
                    <span className="text-rose-300">
                      <strong>Replace All</strong> (Destructive: Clears existing library first)
                    </span>
                  </label>
                </div>
              </div>

              {importStatus && (
                <div
                  className={`p-3 rounded border text-xs ${
                    importStatus.success
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800 text-rose-300'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {importStatus.success ? (
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-medium">{importStatus.message}</p>
                      {importStatus.errors && importStatus.errors.length > 0 && (
                        <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-[11px] font-mono text-neutral-300">
                          {importStatus.errors.map((e, idx) => (
                            <li key={idx}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={handleExecuteImport}
                  disabled={isLoading || !importText.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium transition"
                >
                  {isLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {isLoading ? 'Validating & Writing...' : 'Validate & Commit Import'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-neutral-800 bg-neutral-950">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePurgePseudoDocs}
              title="Remove any sample or pseudo documents"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-amber-400 hover:text-amber-300 rounded border border-amber-900/50 hover:bg-amber-950/30 transition"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Purge Pseudo Documents</span>
            </button>
            <button
              onClick={handleClearAll}
              title="Delete all records from IndexedDB"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 rounded border border-rose-900/50 hover:bg-rose-950/30 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Entire Library</span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 rounded hover:bg-neutral-800 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
