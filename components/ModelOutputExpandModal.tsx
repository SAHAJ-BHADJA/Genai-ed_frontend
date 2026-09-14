'use client';

import { useEffect, useState } from 'react';
import { X, Copy, Check, Maximize2 } from 'lucide-react';
import Markdown from './Markdown';

interface ModelOutputExpandModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelName: string;
  modelIcon?: string;
  modelAccent?: string;
  modelProvider?: string;
  content: string;
  latencyMs?: number;
}

export function ModelOutputExpandModal({
  isOpen,
  onClose,
  modelName,
  modelIcon,
  modelAccent,
  modelProvider,
  content,
  latencyMs
}: ModelOutputExpandModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-t-4 bg-white shadow-2xl"
        style={{ borderTopColor: modelAccent || '#a90000' }}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex items-center gap-3">
            {modelIcon ? (
              <span className="text-2xl">{modelIcon}</span>
            ) : modelAccent ? (
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-white shadow-sm"
                style={{ backgroundColor: modelAccent }}
              />
            ) : null}
            <div>
              <h2 id="modal-title" className="font-semibold text-gray-900 text-lg">
                {modelName}
              </h2>
              {(modelProvider || (latencyMs !== undefined && latencyMs > 0)) && (
                <p className="mt-0.5 text-xs text-gray-600">
                  {[modelProvider, latencyMs !== undefined && latencyMs > 0 ? `${(latencyMs / 1000).toFixed(1)}s response time` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-5 h-5 text-green-600" />
              ) : (
                <Copy className="w-5 h-5 text-gray-600" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-7 sm:px-10">
          <div className="prose prose-sm mx-auto max-w-3xl [&_.markdown-content]:text-[15px] [&_.markdown-content]:leading-7">
            <Markdown value={content} />
          </div>
        </div>

        {copied && (
          <div className="absolute bottom-6 right-6 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg animate-fade-in">
            Copied to clipboard!
          </div>
        )}
      </div>
    </div>
  );
}

export function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 hover:bg-gray-200 rounded transition-colors"
      title="Expand output"
      aria-label="Expand output"
    >
      <Maximize2 className="w-4 h-4 text-gray-600" />
    </button>
  );
}
