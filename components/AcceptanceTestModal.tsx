'use client';

import React, { useState } from 'react';
import { AcceptanceTestReport, TestResultItem } from '@/lib/db/types';
import { runAcceptanceTests } from '@/lib/db';
import { CheckCircle2, XCircle, Play, ShieldCheck, Clock, AlertTriangle, X } from 'lucide-react';

interface AcceptanceTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AcceptanceTestModal({ isOpen, onClose }: AcceptanceTestModalProps) {
  const [report, setReport] = useState<AcceptanceTestReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  if (!isOpen) return null;

  const handleRun = async () => {
    setIsRunning(true);
    try {
      const res = await runAcceptanceTests();
      setReport(res);
    } catch (err: any) {
      console.error('Acceptance test runner failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-700 text-neutral-100 rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-neutral-100">
                Acceptance Verification Suite (Tests A–H)
              </h2>
              <p className="text-xs text-neutral-400">
                Empirical verification executed against an isolated IndexedDB test instance.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-100 rounded-md hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="bg-neutral-950 p-4 rounded-md border border-neutral-800 text-xs text-neutral-300 leading-relaxed">
            <p className="font-medium text-neutral-200 mb-1">Evidence Standard:</p>
            This suite tests real IndexedDB transactions, record creation, immutable timestamps,
            multitype retrieval, Unicode byte fidelity, receipt verification statuses, full backup round-trips,
            and error-handling honesty.
          </div>

          {!report && !isRunning && (
            <div className="text-center py-10 text-neutral-400">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-neutral-600" />
              <p className="text-sm">Click &ldquo;Execute Suite&rdquo; to run all 8 acceptance tests.</p>
            </div>
          )}

          {isRunning && (
            <div className="text-center py-10 text-neutral-300 space-y-3">
              <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full" />
              <p className="text-sm font-medium">Running acceptance verification in real browser IndexedDB...</p>
            </div>
          )}

          {report && !isRunning && (
            <div className="space-y-4">
              {/* Summary Bar */}
              <div className="flex items-center justify-between p-3 rounded-md bg-neutral-800/80 border border-neutral-700">
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-neutral-400">Total:</span>{' '}
                    <span className="font-semibold text-neutral-200">{report.totalTests}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Passed:</span>{' '}
                    <span className="font-semibold text-emerald-400">{report.passedCount}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Failed:</span>{' '}
                    <span className={`font-semibold ${report.failedCount > 0 ? 'text-rose-400' : 'text-neutral-300'}`}>
                      {report.failedCount}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-neutral-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(report.timestamp).toLocaleTimeString()}
                </div>
              </div>

              {/* Test List */}
              <div className="space-y-2.5">
                {report.results.map((t: TestResultItem) => (
                  <div
                    key={t.id}
                    className={`p-3.5 rounded-md border text-xs transition ${
                      t.passed
                        ? 'bg-neutral-950/70 border-emerald-900/60'
                        : 'bg-rose-950/20 border-rose-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {t.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-semibold text-neutral-100 flex items-center gap-2">
                            <span>{t.name}</span>
                            <span className="text-[10px] text-neutral-400 font-mono">({t.durationMs}ms)</span>
                          </div>
                          <p className="text-neutral-400 text-[11px] mt-0.5">{t.description}</p>
                          <p className={`mt-1 font-mono text-[11px] ${t.passed ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {t.message}
                          </p>
                          {t.details && (
                            <pre className="mt-2 p-2 bg-neutral-900 rounded border border-neutral-800 text-[10px] font-mono text-neutral-300 overflow-x-auto">
                              {JSON.stringify(t.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                          t.passed
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {t.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-neutral-800 bg-neutral-950">
          <span className="text-[11px] text-neutral-400">
            Acceptance standard: Verifiable empirical evidence required.
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 rounded hover:bg-neutral-800 transition"
            >
              Close
            </button>
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium transition"
            >
              <Play className="w-3.5 h-3.5" />
              {isRunning ? 'Running...' : report ? 'Re-run Suite' : 'Execute Suite'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
