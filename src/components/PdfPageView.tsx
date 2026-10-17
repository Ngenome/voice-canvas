import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircleQuestion, ImageIcon } from "lucide-react";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { loadPdf, renderPage, renderTextLayer, type Highlight } from "../lib/documents";

/** Loads the stored PDF once and shares it. */
export function usePdf(fileId: string | undefined) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.3);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError(null);
    if (!fileId) return;
    loadPdf(fileId)
      .then(async (doc) => {
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (!cancelled) {
          setRatio(vp.height / vp.width);
          setPdf(doc);
        }
      })
      .catch(() => !cancelled && setError("Couldn't load the original PDF."));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return { pdf, error, ratio };
}

interface PageCanvasProps {
  pdf: PDFDocumentProxy;
  pageNum: number;
  width: number;
  ratio: number;
  /** Render only while near the viewport (for long documents). */
  lazy?: boolean;
  /** Highlights on this page. */
  highlights?: Highlight[];
  /** Search text to mark on the page. */
  query?: string;
  /** Called with re-measured rects for highlights carried over from an older version. */
  onRelocate?: (highlightId: string, rects: Highlight["rects"]) => void;
}

const normText = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Finds a highlight's text in the page's text layer and measures it, as fractions of the page. */
function locateInLayer(layer: HTMLElement, surface: HTMLElement, text: string): Highlight["rects"] {
  const spans = [...layer.querySelectorAll("span")].filter((s) => (s.textContent || "").trim());
  let joined = "";
  const starts: number[] = [];
  for (const s of spans) {
    starts.push(joined.length);
    joined += normText(s.textContent || "") + " ";
  }
  const needle = normText(text);
  let at = joined.indexOf(needle);
  let len = needle.length;
  if (at < 0 && needle.length > 40) {
    at = joined.indexOf(needle.slice(0, 40));
    len = 40;
  }
  if (at < 0) return [];
  const box = surface.getBoundingClientRect();
  const lines: { left: number; right: number; top: number; bottom: number }[] = [];
  spans.forEach((s, i) => {
    const sStart = starts[i];
    const sEnd = sStart + normText(s.textContent || "").length;
    if (sEnd <= at || sStart >= at + len) return;
    const r = s.getBoundingClientRect();
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - r.top) < 3) last.right = Math.max(last.right, r.right);
    else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  });
  return lines.map((r) => ({
    x: (r.left - box.left) / box.width,
    y: (r.top - box.top) / box.height,
    w: (r.right - r.left) / box.width,
    h: (r.bottom - r.top) / box.height,
  }));
}

/** One rendered PDF page. Draws when near the screen and frees memory when far away. */
/** Marks text-layer pieces containing the search text. */
function markMatches(layer: HTMLElement, query: string) {
  const q = query.trim().toLowerCase();
  for (const span of layer.querySelectorAll("span")) {
    const hitNow = q.length >= 2 && (span.textContent || "").toLowerCase().includes(q);
    span.classList.toggle("search-hit", hitNow);
  }
}

export const PageCanvas = memo(function PageCanvas({ pdf, pageNum, width, ratio, lazy = true, highlights, query = "", onRelocate }: PageCanvasProps) {
  const [layerReady, setLayerReady] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(!lazy);
  const [drawn, setDrawn] = useState(false);
  const pendingRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!lazy || !holderRef.current) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "1500px 0px" });
    io.observe(holderRef.current);
    return () => io.disconnect();
  }, [lazy]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    if (!near) {
      canvas.width = 0;
      canvas.height = 0;
      setDrawn(false);
      return;
    }
    let task: RenderTask | null = null;
    let cancelled = false;
    // pdf.js refuses two renders on one canvas, so wait for the previous one to settle.
    const run = pendingRef.current
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        return renderPage(pdf, pageNum, canvas, width, (t) => {
          task = t;
        }).then(() => {
          if (!cancelled) setDrawn(true);
        });
      })
      .catch(() => {});
    pendingRef.current = run;
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNum, width, near]);

  useEffect(() => {
    if (textRef.current) markMatches(textRef.current, query);
  }, [query]);

  // Highlights carried from an older version arrive without rects: measure them on this page.
  useEffect(() => {
    if (!layerReady || !onRelocate || !textRef.current || !holderRef.current) return;
    for (const h of highlights || []) {
      if (h.rects.length || h.missing) continue;
      onRelocate(h.id, locateInLayer(textRef.current, holderRef.current, h.text));
    }
  }, [layerReady, highlights, onRelocate]);

  // Selectable text over the drawn page; built only for pages near the screen.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (!near || width <= 0) {
      el.replaceChildren();
      return;
    }
    let layer: TextLayer | null = null;
    let cancelled = false;
    renderTextLayer(pdf, pageNum, el, width)
      .then((l) => {
        layer = l;
        if (cancelled) l.cancel();
        else {
          markMatches(el, queryRef.current);
          setLayerReady((n) => n + 1);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [pdf, pageNum, width, near]);

  return (
    <div ref={holderRef} data-page-surface={pageNum} className="relative bg-white rounded-sm overflow-hidden shadow-md" style={{ width, height: width * ratio }}>
      <canvas ref={canvasRef} className="block" style={{ width, height: width * ratio }} />
      {/* Highlights sit between the drawn page and the selectable text. */}
      {highlights?.filter((h) => h.rects.length).map((h) =>
        h.rects.map((r, i) => (
          <div
            key={`${h.id}-${i}`}
            className="absolute pointer-events-none rounded-[2px]"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              background: "rgba(255, 214, 10, 0.42)",
              mixBlendMode: "multiply",
            }}
          />
        )),
      )}
      <div ref={textRef} className="textLayer" />
      {!drawn && (
        <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
          {near ? <Loader2 className="w-4 h-4 animate-spin" /> : `Page ${pageNum}`}
        </div>
      )}
    </div>
  );
});

interface PdfPageViewProps {
  fileId: string;
  pageCount: number;
  /** Page the agent is reading now; the view follows it. */
  focusPage?: number;
  /** Page to open on (the one you were looking at in the other view). */
  initialPage?: number;
  /** Reports the page at the top of the view as you scroll. */
  onViewPage?: (page: number) => void;
  figurePages?: number[];
  highlights?: Highlight[];
  docId?: string;
  onRelocateHighlight?: (docId: string, highlightId: string, rects: Highlight["rects"]) => void;
  /** Search text to mark on visible pages. */
  searchQuery?: string;
  maxWidth: number;
  onAskAboutPage: (page: number) => void;
}

export function PdfPageView({
  fileId,
  pageCount,
  focusPage,
  initialPage,
  onViewPage,
  figurePages,
  highlights,
  docId,
  onRelocateHighlight,
  searchQuery,
  maxWidth,
  onAskAboutPage,
}: PdfPageViewProps) {
  const relocate = useCallback(
    (hid: string, rects: Highlight["rects"]) => {
      if (docId) onRelocateHighlight?.(docId, hid, rects);
    },
    [docId, onRelocateHighlight],
  );
  const { pdf, error, ratio } = usePdf(fileId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const figures = new Set(figurePages || []);
  const byPage = new Map<number, Highlight[]>();
  for (const h of highlights || []) byPage.set(h.page, [...(byPage.get(h.page) || []), h]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placedRef = useRef(false);
  const lastFocusRef = useRef(focusPage);
  const tickRef = useRef(0);

  // First time the pages are laid out, open on the page you were looking at (or the reading position).
  useEffect(() => {
    if (!pdf || containerWidth === 0 || placedRef.current) return;
    placedRef.current = true;
    const target = initialPage ?? focusPage;
    if (target && target > 1) scrollRef.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, containerWidth]);

  // Afterwards, follow the agent when the reading moves to another page.
  useEffect(() => {
    if (!pdf || !focusPage || focusPage === lastFocusRef.current) return;
    lastFocusRef.current = focusPage;
    scrollRef.current?.querySelector(`[data-page="${focusPage}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pdf, focusPage]);

  const onScroll = () => {
    if (tickRef.current || !onViewPage) return;
    tickRef.current = requestAnimationFrame(() => {
      tickRef.current = 0;
      const root = scrollRef.current;
      if (!root) return;
      const r = root.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 70)?.closest("[data-page]");
      const page = hit ? Number(hit.getAttribute("data-page")) : NaN;
      if (page) onViewPage(page);
    });
  };

  // Round width so small resizes don't trigger re-renders of every page.
  const width = Math.max(240, Math.floor(Math.min(containerWidth - 64, maxWidth) / 20) * 20);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-sunken" onScroll={onScroll}>
      {error ? (
        <p className="p-10 text-center text-danger">{error}</p>
      ) : !pdf || containerWidth === 0 ? (
        <div className="p-16 flex justify-center text-faint">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div data-pages className="flex flex-col items-center gap-6 py-8 pb-24">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <div key={n} data-page={n} className="group relative" style={{ scrollMarginTop: 16 }}>
              <PageCanvas pdf={pdf} pageNum={n} width={width} ratio={ratio} highlights={byPage.get(n)} query={searchQuery} onRelocate={relocate} />
              <div
                className={`absolute -top-0 left-0 right-0 flex items-center justify-between px-2 py-1.5 text-xs font-sans ${
                  n === focusPage ? "" : "opacity-0 group-hover:opacity-100"
                } transition-opacity`}
              >
                <span className={`px-2 py-0.5 rounded-md ${n === focusPage ? "bg-accent text-accent-fg" : "bg-black/60 text-white"}`}>
                  Page {n}
                  {figures.has(n) && <ImageIcon className="inline w-3 h-3 ml-1.5 -mt-0.5" />}
                </span>
                <button className="btn h-7 text-xs bg-black/70 !text-white hover:!bg-black/85" onClick={() => onAskAboutPage(n)}>
                  <MessageCircleQuestion className="w-3.5 h-3.5" /> Ask about this page
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
