'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

type SocraticPdfReaderProps = {
  url: string;
  title: string;
  onOpened?: () => void;
  onReachedEnd?: () => void;
};

const END_THRESHOLD_PX = 32;
const PDF_SCALE = 1.35;
const PDF_TO_CSS_UNITS = 96 / 72;

export default function SocraticPdfReader({
  url,
  title,
  onOpened,
  onReachedEnd,
}: SocraticPdfReaderProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pagesHostRef = useRef<HTMLDivElement | null>(null);
  const onOpenedRef = useRef(onOpened);
  const onReachedEndRef = useRef(onReachedEnd);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [renderedPageCount, setRenderedPageCount] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(0);
  const reachedEndRef = useRef(false);

  useEffect(() => {
    onOpenedRef.current = onOpened;
  }, [onOpened]);

  useEffect(() => {
    onReachedEndRef.current = onReachedEnd;
  }, [onReachedEnd]);

  useEffect(() => {
    const host = pagesHostRef.current;
    if (!host) return;

    const updateViewerWidth = () => {
      const nextWidth = Math.floor(host.getBoundingClientRect().width);
      setViewerWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateViewerWidth();
    const observer = new ResizeObserver(updateViewerWidth);
    observer.observe(host);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewerWidth <= 0) return;
    const host = pagesHostRef.current;
    if (!host) return;

    let active = true;
    let pageViews: Array<{ destroy: () => void }> = [];
    let pdfDocument: any = null;

    const loadPdf = async () => {
      setLoading(true);
      setError(null);
      setRenderedPageCount(0);
      reachedEndRef.current = false;
      setReachedEnd(false);

      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const pdfjsViewer: any = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF (${response.status}).`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const pdfData = new Uint8Array(arrayBuffer);
        const loadingTask = pdfjs.getDocument({ data: pdfData });
        pdfDocument = await loadingTask.promise;

        if (!active) {
          await pdfDocument?.destroy?.();
          return;
        }

        host.replaceChildren();
        const eventBus = new pdfjsViewer.EventBus();

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const pdfPage = await pdfDocument.getPage(pageNumber);
          const unscaledViewport = pdfPage.getViewport({ scale: 1 });
          const fittedScale = Math.min(
            PDF_SCALE,
            viewerWidth / (unscaledViewport.width * PDF_TO_CSS_UNITS),
          );
          const viewport = pdfPage.getViewport({
            scale: fittedScale * PDF_TO_CSS_UNITS,
          });

          const pageView = new pdfjsViewer.PDFPageView({
            container: host,
            eventBus,
            id: pageNumber,
            scale: fittedScale,
            defaultViewport: viewport.clone(),
          });

          pageView.setPdfPage(pdfPage);
          await pageView.draw();
          pageViews.push(pageView);

          if (!active) {
            return;
          }

          setRenderedPageCount(pageNumber);
        }

        if (!active) return;
        setLoading(false);
        onOpenedRef.current?.();
      } catch (nextError) {
        if (!active) return;
        console.error('SocraticPdfReader failed to render PDF', {
          url,
          error: nextError,
        });
        setError(nextError instanceof Error ? nextError.message : 'Failed to load PDF.');
        setLoading(false);
      }
    };

    void loadPdf();

    return () => {
      active = false;
      pageViews.forEach((pageView) => pageView.destroy());
      pageViews = [];
      host.replaceChildren();
      void pdfDocument?.destroy?.();
    };
  }, [url, viewerWidth]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (reachedEndRef.current) return;
      const atEnd =
        container.scrollTop + container.clientHeight >= container.scrollHeight - END_THRESHOLD_PX;
      if (!atEnd) return;

      reachedEndRef.current = true;
      setReachedEnd(true);
      onReachedEndRef.current?.();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [renderedPageCount]);

  return (
    <>
      <style jsx global>{`
        .socratic-pdf-viewer {
          --page-bg-color: #ffffff;
          contain: inline-size;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .socratic-pdf-viewer > div:first-child {
          contain: inline-size;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .socratic-pdf-viewer .page {
          position: relative;
          margin: 0 auto 1.25rem;
          background: var(--page-bg-color);
          box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
          overflow: hidden;
          min-width: 0 !important;
          max-width: 100%;
        }

        .socratic-pdf-viewer .canvasWrapper {
          overflow: hidden;
        }

        .socratic-pdf-viewer .canvasWrapper canvas {
          display: block;
          width: 100%;
          height: auto;
        }

        .socratic-pdf-viewer .textLayer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          line-height: 1;
          forced-color-adjust: none;
          -webkit-text-size-adjust: none;
          text-size-adjust: none;
          z-index: 2;
        }

        .socratic-pdf-viewer .textLayer span,
        .socratic-pdf-viewer .textLayer br {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
          user-select: text;
        }

        .socratic-pdf-viewer .textLayer .endOfContent {
          position: absolute;
          inset: 100% 0 0;
          z-index: -1;
          cursor: default;
          user-select: none;
        }

        .socratic-pdf-viewer .textLayer::selection,
        .socratic-pdf-viewer .textLayer span::selection {
          background: rgba(153, 27, 27, 0.22);
        }
      `}</style>

      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
          <h4 className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{title}</h4>
          <p className="text-xs text-gray-600 mt-1">
            Scroll to the end of the PDF to unlock completion.
          </p>
        </div>
        <div ref={scrollRef} className="relative min-w-0 max-w-full overflow-x-hidden overflow-y-auto bg-gray-100 max-h-[min(70vh,760px)]">
          <div className="socratic-pdf-viewer min-w-0 max-w-full p-3 sm:p-5">
            <div ref={pagesHostRef} className="w-full min-w-0 max-w-full overflow-x-hidden" />
            {!loading && !error && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-5 text-center text-sm text-gray-600">
                {reachedEnd ? 'You reached the end of the PDF.' : 'Keep scrolling to reach the end of the PDF.'}
              </div>
            )}
          </div>

          {loading && (
            <div className="absolute inset-0 z-10 flex min-h-[420px] items-center justify-center bg-white/92 text-gray-600">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm">Loading {title}...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 z-10 flex min-h-[220px] items-center justify-center bg-white/96 p-6">
              <div className="w-full rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
                {error}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
