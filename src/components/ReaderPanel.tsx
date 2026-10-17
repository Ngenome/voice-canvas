import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, FileUp, Globe, ImageIcon, Loader2, MessageCircleQuestion, X, ClipboardPaste } from "lucide-react";
import {
  documentFromPdf,
  documentFromText,
  loadPdf,
  scanFigurePages,
  uploadPdf,
  type DocParagraph,
  type Highlight,
  type ReadingDocument,
} from "../lib/documents";
import { PageCanvas, PdfPageView, usePdf } from "./PdfPageView";
import { SelectionToolbar, type SelectionAction } from "./SelectionToolbar";
import { DocSearch, type SearchMatch } from "./DocSearch";
import { ViewMenu } from "./ViewMenu";
import { readWebpage } from "../lib/exa";

export type ParagraphAction = "explain";

interface ReaderPanelProps {
  doc: ReadingDocument | null;
  /** Passages the agent is reading right now (inclusive). */
  range?: [number, number] | null;
  onOpen: (doc: ReadingDocument) => void;
  onClose: () => void;
  onParagraphAction: (index: number, action: ParagraphAction) => void;
  /** Ask the agent about a page, sending it a picture of that page. */
  onAskAboutPage: (page: number) => void;
  /** Link an uploaded original PDF to the open document. */
  onAttachFile: (fileId: string, figurePages: number[]) => void;
  /** Reports where the user is reading as they scroll. */
  onViewPosition?: (pos: { index?: number; page?: number }) => void;
  /** Copy / ask / note / highlight on selected text. */
  onSelectionAction?: (action: SelectionAction) => void;
  /** Every document (and version) in this session. */
  shelf?: ReadingDocument[];
  onSwitchDocument?: (id: string) => void;
  onRemoveDocument?: (id: string) => void;
  /** Adds an uploaded file as the next version of `baseId`. */
  onAddVersion?: (baseId: string, fresh: ReadingDocument) => void;
  /** Pages view found where a carried-over highlight now sits. */
  onRelocateHighlight?: (docId: string, highlightId: string, rects: Highlight["rects"]) => void;
  /** Adding a document (or a new version) shows the open screen in place of the reader. */
  adding?: null | { kind: "new" } | { kind: "version"; baseId: string; title: string };
  onAddingChange?: (v: null | { kind: "new" } | { kind: "version"; baseId: string; title: string }) => void;
  /** Where the reading controls render (the app's top bar). */
  toolsSlot?: HTMLElement | null;
}

const FONT_STEPS = [1.02, 1.12, 1.22, 1.34, 1.48];

function readFontStep(): number {
  try {
    const v = Number(localStorage.getItem("vc_reader_font") ?? 2);
    return Number.isInteger(v) && v >= 0 && v < FONT_STEPS.length ? v : 2;
  } catch {
    return 2;
  }
}

type ParaState = "read" | "current" | "unread";
type ViewMode = "text" | "pages";
type WidthMode = "comfortable" | "wide" | "full";

const WIDTHS: Record<WidthMode, { text: string; pages: number; label: string }> = {
  comfortable: { text: "68ch", pages: 820, label: "Comfortable width" },
  wide: { text: "92ch", pages: 1100, label: "Wide" },
  full: { text: "none", pages: 1800, label: "Full width" },
};
const WIDTH_ORDER: WidthMode[] = ["comfortable", "wide", "full"];

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

interface PassageProps {
  index: number;
  text: string;
  page?: number;
  isHeading?: boolean;
  showPage: boolean;
  hasFigure: boolean;
  state: ParaState;
  active: boolean;
  onActivate: (index: number | null) => void;
  onAction: (index: number, action: ParagraphAction) => void;
  onShowPage: (page: number) => void;
  /** Current search match inside this passage, if any. */
  hitStart?: number;
  hitLen?: number;
}

/** One passage. Memoized so a highlight change only re-renders the passages involved. */
const Passage = memo(function Passage({
  index,
  text,
  page,
  isHeading,
  showPage,
  hasFigure,
  state,
  active,
  onActivate,
  onAction,
  onShowPage,
  hitStart,
  hitLen,
}: PassageProps) {
  return (
    <div data-index={index} className="reader-block">
      {showPage && (
        <div className="flex items-center gap-3 my-6 select-none font-sans">
          <div className="h-px flex-1 bg-line" />
          <span className="text-[0.7rem] text-faint">page {page}</span>
          {hasFigure && page && (
            <button className="btn h-7 text-xs px-2.5 btn-quiet" onClick={() => onShowPage(page)} title="See this page as printed, with its figures">
              <ImageIcon className="w-3.5 h-3.5" /> Figure on this page
            </button>
          )}
          <div className="h-px flex-1 bg-line" />
        </div>
      )}
      <div
        className={`reader-para ${isHeading ? "reader-heading" : ""}`}
        data-state={state}
        onMouseEnter={() => onActivate(index)}
        onClick={() => onActivate(index)}
      >
        {hitStart !== undefined && hitLen ? (
          <>
            {text.slice(0, hitStart)}
            <mark className="search-mark search-current">{text.slice(hitStart, hitStart + hitLen)}</mark>
            {text.slice(hitStart + hitLen)}
          </>
        ) : (
          text
        )}
        {active && (
          <>
            <div className="absolute -right-2 top-1 translate-x-full hidden lg:flex flex-col gap-1 font-sans fade-in">
              <button className="btn btn-icon bg-surface border border-line h-8 w-8" onClick={() => onAction(index, "explain")} title="Explain this passage">
                <MessageCircleQuestion className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex lg:hidden gap-1 mt-1 font-sans fade-in">
              <button
                className="btn h-7 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(index, "explain");
                }}
              >
                <MessageCircleQuestion className="w-3 h-3" /> Explain
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

const CHUNK = 50;

interface ChunkProps {
  paragraphs: DocParagraph[];
  figures: Set<number>;
  start: number;
  end: number; // exclusive
  /** Passages before this index count as read. Clamped to the chunk. */
  readBoundary: number;
  /** Highlighted range clamped to the chunk, or -1. */
  curStart: number;
  curEnd: number;
  /** Hovered/selected passage if it is in this chunk, else -1. */
  active: number;
  onActivate: (index: number | null) => void;
  onAction: (index: number, action: ParagraphAction) => void;
  onShowPage: (page: number) => void;
  /** Current search hit if it falls in this chunk. */
  hit: SearchMatch | null;
  hitLen: number;
}

/** A block of passages. Only chunks whose props change re-render, which keeps big books fast. */
const Chunk = memo(function Chunk({
  paragraphs,
  figures,
  start,
  end,
  readBoundary,
  curStart,
  curEnd,
  active,
  onActivate,
  onAction,
  onShowPage,
  hit,
  hitLen,
}: ChunkProps) {
  const items = [];
  for (let i = start; i < end; i++) {
    const p = paragraphs[i];
    const state: ParaState = curStart >= 0 && i >= curStart && i <= curEnd ? "current" : i < readBoundary ? "read" : "unread";
    const showPage = !!p.page && i > 0 && p.page !== paragraphs[i - 1]?.page;
    items.push(
      <Passage
        key={i}
        index={i}
        text={p.text}
        page={p.page}
        isHeading={p.isHeading}
        showPage={showPage}
        hasFigure={showPage && !!p.page && figures.has(p.page)}
        state={state}
        active={active === i}
        onActivate={onActivate}
        onAction={onAction}
        onShowPage={onShowPage}
        hitStart={hit?.index === i ? hit.start : undefined}
        hitLen={hit?.index === i ? hitLen : undefined}
      />,
    );
  }
  return <>{items}</>;
});

/** A large view of one page, opened from a figure marker. */
function PageLightbox({
  fileId,
  page,
  highlights,
  onClose,
  onAsk,
}: {
  fileId: string;
  page: number;
  highlights?: Highlight[];
  onClose: () => void;
  onAsk: (page: number) => void;
}) {
  const { pdf, error, ratio } = usePdf(fileId);
  const width = Math.floor(Math.min(980, window.innerWidth - 48, (window.innerHeight - 140) / ratio));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-6 fade-in">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative flex items-center gap-2">
        <span className="text-sm text-white/80 font-sans mr-2">Page {page}</span>
        <button className="btn btn-primary h-8 text-xs" onClick={() => onAsk(page)}>
          <MessageCircleQuestion className="w-3.5 h-3.5" /> Ask about this page
        </button>
        <button className="btn h-8 text-xs bg-white/10 !text-white hover:!bg-white/20" onClick={onClose}>
          <X className="w-3.5 h-3.5" /> Close
        </button>
      </div>
      <div className="relative">
        {error ? (
          <p className="text-white">{error}</p>
        ) : pdf ? (
          <PageCanvas pdf={pdf} pageNum={page} width={width} ratio={ratio} lazy={false} highlights={highlights?.filter((h) => h.page === page)} />
        ) : (
          <Loader2 className="w-6 h-6 animate-spin text-white" />
        )}
      </div>
    </div>
  );
}

/** For documents opened before page view existed: link the original PDF. */
function AttachPdf({ doc, onAttach }: { doc: ReadingDocument; onAttach: (fileId: string, figurePages: number[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const attach = async (file: File) => {
    setError(null);
    try {
      setBusy("Saving the PDF...");
      const fileId = await uploadPdf(file);
      const pdf = await loadPdf(fileId);
      if (doc.pageCount && pdf.numPages !== doc.pageCount) {
        throw new Error(`That PDF has ${pdf.numPages} pages, but this document has ${doc.pageCount}. Pick the same file.`);
      }
      const figs = await scanFigurePages(fileId, (n, total) => setBusy(`Looking for figures: page ${n} of ${total}...`));
      onAttach(fileId, figs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't attach that file.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center rise">
        <div className="w-11 h-11 mx-auto rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-4">
          <FileUp className="w-5 h-5" />
        </div>
        <h3 className="font-serif text-xl font-medium">Page view needs the original PDF</h3>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          This document was opened before pages were saved. Choose the same file once and you'll get the real pages, figures and all.
        </p>
        {busy ? (
          <p className="mt-5 text-sm text-muted flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent" /> {busy}
          </p>
        ) : (
          <button className="btn btn-primary mt-5" onClick={() => fileRef.current?.click()}>
            Choose the PDF
          </button>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export const ReaderPanel = memo(function ReaderPanel({
  doc,
  range,
  toolsSlot,
  onOpen,
  onParagraphAction,
  onAskAboutPage,
  onAttachFile,
  onViewPosition,
  onSelectionAction,
  onAddVersion,
  onRelocateHighlight,
  adding = null,
  onAddingChange,
}: ReaderPanelProps) {
  /** Adding a document (or a new version of one) shows the open screen in place of the reader. */
  const setAdding = (v: ReaderPanelProps["adding"]) => onAddingChange?.(v ?? null);
  const [showMissing, setShowMissing] = useState(false);
  const [fontStep, setFontStep] = useState(readFontStep);
  const [view, setView] = useState<ViewMode>(() => readPref("vc_reader_view", ["text", "pages"] as const, "text"));
  const [widthMode, setWidthMode] = useState<WidthMode>(() => readPref("vc_reader_width", WIDTH_ORDER, "comfortable"));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => writePref("vc_reader_font", String(fontStep)), [fontStep]);
  useEffect(() => writePref("vc_reader_view", view), [view]);
  useEffect(() => writePref("vc_reader_width", widthMode), [widthMode]);

  /** Set only when the agent points somewhere (go to a page, turn a page). */
  const focusIndex = range ? range[0] : -1;
  const figures = useMemo(() => new Set(doc?.figurePages || []), [doc?.figurePages]);

  /** The page currently at the top of whichever view is showing, so switching views keeps your place. */
  const viewPageRef = useRef<number | null>(null);
  const scrollTickRef = useRef(0);

  // When the agent points somewhere, take the user there.
  useEffect(() => {
    if (focusIndex < 0 || view !== "text") return;
    const el = scrollRef.current?.querySelector(`[data-index="${focusIndex}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const lastDocIdRef = useRef<string | undefined>(undefined);

  // On switching into text view, land on the page you were looking at.
  useEffect(() => {
    if (lastDocIdRef.current !== doc?.id) {
      lastDocIdRef.current = doc?.id;
      viewPageRef.current = null;
    }
    if (view !== "text" || !doc) return;
    const page = viewPageRef.current;
    const idx = page ? doc.paragraphs.findIndex((p) => (p.page ?? 0) >= page) : doc.position;
    if (idx < 0) return;
    const el = scrollRef.current?.querySelector(`[data-index="${idx}"]`);
    if (!el) return;
    // Off-screen passages have estimated heights; re-apply the jump as nearby ones render at their real size.
    const block: ScrollLogicalPosition = page ? "start" : "center";
    el.scrollIntoView({ block });
    const raf = requestAnimationFrame(() => el.scrollIntoView({ block }));
    const t1 = setTimeout(() => el.scrollIntoView({ block }), 80);
    const t2 = setTimeout(() => el.scrollIntoView({ block }), 220);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, doc?.id]);

  const onTextScroll = useCallback(() => {
    if (scrollTickRef.current) return;
    scrollTickRef.current = requestAnimationFrame(() => {
      scrollTickRef.current = 0;
      const root = scrollRef.current;
      if (!root || !doc) return;
      const r = root.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 70)?.closest("[data-index]");
      const idx = hit ? Number(hit.getAttribute("data-index")) : NaN;
      if (Number.isNaN(idx)) return;
      const page = doc.paragraphs[idx]?.page;
      if (page) viewPageRef.current = page;
      onViewPosition?.({ index: idx, page });
    });
  }, [doc, onViewPosition]);

  const onPagesViewPage = useCallback(
    (page: number) => {
      viewPageRef.current = page;
      onViewPosition?.({ page });
    },
    [onViewPosition],
  );

  const handleActivate = useCallback((i: number | null) => setActiveIndex(i), []);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ── Find in document ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(""); // debounced
  const [activeMatch, setActiveMatch] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 120);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setActiveMatch(0), [q, doc?.id]);

  const { matches, capped } = useMemo(() => {
    const out: SearchMatch[] = [];
    if (!doc || q.length < 2) return { matches: out, capped: false };
    const needle = q.toLowerCase();
    const LIMIT = 500;
    for (let i = 0; i < doc.paragraphs.length; i++) {
      const t = doc.paragraphs[i].text;
      const hay = t.toLowerCase();
      let at = hay.indexOf(needle);
      while (at >= 0) {
        if (out.length >= LIMIT) return { matches: out, capped: true };
        out.push({
          index: i,
          page: doc.paragraphs[i].page,
          start: at,
          before: (at > 50 ? "..." : "") + t.slice(Math.max(0, at - 50), at),
          match: t.slice(at, at + needle.length),
          after: t.slice(at + needle.length, at + needle.length + 70) + (at + needle.length + 70 < t.length ? "..." : ""),
        });
        at = hay.indexOf(needle, at + needle.length);
      }
    }
    return { matches: out, capped: false };
  }, [doc, q]);
  const hit = searchOpen ? matches[activeMatch] ?? null : null;

  // Ctrl/Cmd+F opens the reader's own search (it covers the whole document, unlike the browser's).
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setSearchNonce((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc]);
  const pageOfIndex = useCallback((i: number) => doc?.paragraphs[i]?.page, [doc?.paragraphs]);
  const handleSelection = useCallback((a: SelectionAction) => onSelectionAction?.(a), [onSelectionAction]);
  const handleShowPage = useCallback((p: number) => setLightboxPage(p), []);

  useEffect(() => {
    if (!hit || view !== "text") return;
    const el = scrollRef.current?.querySelector(`[data-index="${hit.index}"]`);
    if (!el) return;
    // Re-apply as nearby passages render at their real size (they start with estimated heights).
    el.scrollIntoView({ block: "center" });
    const t1 = setTimeout(() => el.scrollIntoView({ block: "center" }), 80);
    const t2 = setTimeout(() => el.querySelector(".search-current")?.scrollIntoView({ block: "center" }), 220);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.index, hit?.start, view]);

  if (!doc || adding) {
    const version = adding?.kind === "version" ? adding : null;
    return (
      <EmptyReader
        heading={version ? `New version of "${version.title}"` : adding ? "Add a document to this session" : undefined}
        intro={
          version
            ? "Open the updated file. Your place, notes and conversation stay, and your highlights move to where their text now appears."
            : adding
            ? "It joins this session as another tab, with its own place and highlights. The agent can see both."
            : undefined
        }
        onCancel={adding && doc ? () => setAdding(null) : undefined}
        onOpen={(d) => {
          if (version) onAddVersion?.(version.baseId, d);
          else onOpen(d);
          setAdding(null);
        }}
      />
    );
  }

  const isPdf = doc.source === "pdf";
  const missingHighlights = (doc.highlights || []).filter((h) => h.missing);
  const total = doc.paragraphs.length;
  const pos = Math.max(doc.position, 0);
  const progress = total > 0 ? Math.round(((doc.position + 1) / total) * 100) : 0;
  const agentPage = focusIndex >= 0 ? doc.paragraphs[focusIndex]?.page : undefined;
  const width = WIDTHS[widthMode];
  const showPages = isPdf && view === "pages";

  return (
    <div ref={panelRef} className="h-full flex flex-col min-h-0">
      <SelectionToolbar rootRef={panelRef} pageOfIndex={pageOfIndex} highlights={doc.highlights || []} onAction={handleSelection} />
      <div className="relative">
        {searchOpen && (
          <DocSearch
            key={searchNonce}
            query={query}
            onQuery={setQuery}
            matches={matches}
            capped={capped}
            active={Math.min(activeMatch, Math.max(0, matches.length - 1))}
            onPick={setActiveMatch}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </div>
      {toolsSlot &&
        createPortal(
          <div className="flex items-center gap-0.5">
            <button
              className={`btn btn-icon ${searchOpen ? "btn-on" : ""}`}
              onClick={() => {
                setSearchOpen((o) => !o);
                setSearchNonce((n) => n + 1);
              }}
              title="Search this document (Ctrl+F)"
            >
              <Search className="w-4 h-4" />
            </button>
            <ViewMenu
              isPdf={isPdf}
              view={view}
              onView={setView}
              widthMode={widthMode}
              onWidth={setWidthMode}
              fontStep={fontStep}
              onFont={setFontStep}
              showFont={!showPages}
            />
          </div>,
          toolsSlot,
        )}
      {missingHighlights.length > 0 && (
        <div className="px-4 py-2 border-b border-line text-xs text-muted flex-shrink-0 bg-danger-soft">
          <div className="flex items-center gap-2">
            <span className="flex-1">
              {missingHighlights.length} highlight{missingHighlights.length === 1 ? "" : "s"} from the previous version couldn't be found in this one.
            </span>
            <button className="underline hover:text-fg" onClick={() => setShowMissing((v) => !v)}>
              {showMissing ? "Hide" : "Show"}
            </button>
            <button
              className="underline hover:text-fg"
              onClick={() => onSelectionAction?.({ type: "unhighlight", ids: missingHighlights.map((h) => h.id) })}
            >
              Dismiss
            </button>
          </div>
          {showMissing && (
            <ul className="mt-1.5 space-y-1">
              {missingHighlights.map((h) => (
                <li key={h.id} className="italic">
                  “{h.text}”
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="h-[2px] flex-shrink-0">
        <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 min-h-0">
        {showPages ? (
          doc.fileId ? (
            <PdfPageView
              fileId={doc.fileId}
              pageCount={doc.pageCount || 1}
              focusPage={hit?.page ?? agentPage}
              searchQuery={searchOpen ? q : ""}
              initialPage={viewPageRef.current ?? doc.paragraphs[pos]?.page}
              onViewPage={onPagesViewPage}
              figurePages={doc.figurePages}
              highlights={doc.highlights}
              docId={doc.id}
              onRelocateHighlight={onRelocateHighlight}
              maxWidth={width.pages}
              onAskAboutPage={onAskAboutPage}
            />
          ) : (
            <AttachPdf doc={doc} onAttach={onAttachFile} />
          )
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto" onScroll={onTextScroll}>
            <article
              className="reader mx-auto px-8 sm:px-12 py-10 pb-24"
              style={{ fontSize: `${FONT_STEPS[fontStep]}rem`, maxWidth: width.text }}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {Array.from({ length: Math.ceil(total / CHUNK) }, (_, c) => {
                const start = c * CHUNK;
                const end = Math.min(start + CHUNK, total);
                const boundary = -1;
                const inRange = !!range && range[1] >= start && range[0] < end;
                return (
                  <Chunk
                    key={c}
                    paragraphs={doc.paragraphs}
                    figures={figures}
                    start={start}
                    end={end}
                    readBoundary={Math.min(Math.max(boundary, start), end)}
                    curStart={inRange && range ? Math.max(range[0], start) : -1}
                    curEnd={inRange && range ? Math.min(range[1], end - 1) : -1}
                    active={activeIndex !== null && activeIndex >= start && activeIndex < end ? activeIndex : -1}
                    onActivate={handleActivate}
                    onAction={onParagraphAction}
                    onShowPage={handleShowPage}
                    hit={hit && hit.index >= start && hit.index < end ? hit : null}
                    hitLen={q.length}
                  />
                );
              })}
              <p className="font-sans text-center text-sm text-faint mt-16">End of document</p>
            </article>
          </div>
        )}
      </div>

      {lightboxPage !== null &&
        (doc.fileId ? (
          <PageLightbox
            fileId={doc.fileId}
            page={lightboxPage}
            highlights={doc.highlights}
            onClose={() => setLightboxPage(null)}
            onAsk={(p) => {
              setLightboxPage(null);
              onAskAboutPage(p);
            }}
          />
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 fade-in">
            <div className="absolute inset-0 bg-black/60" onClick={() => setLightboxPage(null)} />
            <div className="relative panel rounded-2xl max-w-lg w-full">
              <AttachPdf doc={doc} onAttach={onAttachFile} />
            </div>
          </div>
        ))}
    </div>
  );
});

function EmptyReader({
  onOpen,
  heading,
  intro,
  onCancel,
}: {
  onOpen: (doc: ReadingDocument) => void;
  heading?: string;
  intro?: string;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<"pick" | "paste" | "link">("pick");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const openFile = async (file: File) => {
    setError(null);
    try {
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        setBusy("Opening PDF...");
        const doc = await documentFromPdf(file, (page, total) => setBusy(`Reading page ${page} of ${total}...`));
        if (doc.paragraphs.length === 0) throw new Error("No selectable text found. Scanned PDFs are not supported yet.");
        onOpen(doc);
      } else {
        setBusy("Opening file...");
        const raw = await file.text();
        onOpen(documentFromText(raw, file.name.replace(/\.(txt|md|markdown)$/i, "")));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that file.");
    } finally {
      setBusy(null);
    }
  };

  const openLink = async () => {
    const target = url.trim();
    if (!target) return;
    setError(null);
    setBusy("Fetching the page...");
    try {
      const raw = await readWebpage([target], 60000);
      const body = raw.replace(/^#?\s*.*\nURL:.*\n/m, "");
      const titleMatch = raw.match(/^#?\s*(.+)$/m);
      const doc = documentFromText(body, titleMatch?.[1]?.trim() || target);
      onOpen({ ...doc, source: "web" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fetch that page.");
    } finally {
      setBusy(null);
    }
  };

  // Paste anywhere on the empty reader to open text instantly.
  useEffect(() => {
    if (mode !== "pick") return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const file = e.clipboardData?.files?.[0];
      if (file) {
        e.preventDefault();
        void openFile(file);
        return;
      }
      const pasted = e.clipboardData?.getData("text") || "";
      if (/^https?:\/\/\S+$/.test(pasted.trim())) {
        e.preventDefault();
        setUrl(pasted.trim());
        setMode("link");
      } else if (pasted.trim().length > 40) {
        e.preventDefault();
        onOpen(documentFromText(pasted));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  return (
    <div
      className="h-full overflow-y-auto"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void openFile(file);
      }}
    >
      <div className="min-h-full flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl rise">
          <div className="flex items-center justify-between mb-3">
            <p className="eyebrow">Read together</p>
            {onCancel && (
              <button className="btn h-8 text-xs" onClick={onCancel}>
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
          </div>
          <h1 className="font-serif text-[2.1rem] leading-tight font-medium tracking-tight">{heading ?? "What are we reading today?"}</h1>
          <p className="text-muted mt-3 leading-relaxed">
            {intro ??
              "Open a PDF, paste some text, or drop in a link. Read at your own pace while your agent listens, answers questions, explains, and discusses it with you."}
          </p>

          {busy ? (
            <div className="mt-8 panel rounded-2xl p-6 flex items-center gap-3 text-muted">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>{busy}</span>
            </div>
          ) : mode === "paste" ? (
            <div className="mt-8 space-y-3 rise">
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="Paste an article, chapter, or notes..."
                className="field font-serif text-[1.02rem] leading-relaxed resize-y"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-faint">{text.split(/\s+/).filter(Boolean).length} words</span>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => setMode("pick")}>
                    Back
                  </button>
                  <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onOpen(documentFromText(text))}>
                    Open in reader
                  </button>
                </div>
              </div>
            </div>
          ) : mode === "link" ? (
            <form
              className="mt-8 space-y-3 rise"
              onSubmit={(e) => {
                e.preventDefault();
                void openLink();
              }}
            >
              <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="field" />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => setMode("pick")}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={!url.trim()}>
                  Open page
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-8 grid gap-3">
              <button
                onClick={() => fileRef.current?.click()}
                className={`panel rounded-2xl p-6 text-left flex items-center gap-4 transition-colors border-dashed ${
                  dragging ? "border-accent bg-accent-soft" : "hover:border-line-strong"
                }`}
              >
                <div className="w-11 h-11 rounded-xl bg-accent-soft text-accent flex items-center justify-center flex-shrink-0">
                  <FileUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">Open a PDF or text file</div>
                  <div className="text-sm text-faint">Click to choose, or drop it anywhere here</div>
                </div>
              </button>
              <div className="grid sm:grid-cols-2 gap-3">
                <button onClick={() => setMode("paste")} className="panel rounded-2xl p-4 text-left flex items-center gap-3 hover:border-line-strong transition-colors">
                  <ClipboardPaste className="w-4 h-4 text-muted" />
                  <div>
                    <div className="font-medium text-sm">Paste text</div>
                    <div className="text-xs text-faint">
                      or press <span className="kbd">Ctrl V</span>
                    </div>
                  </div>
                </button>
                <button onClick={() => setMode("link")} className="panel rounded-2xl p-4 text-left flex items-center gap-3 hover:border-line-strong transition-colors">
                  <Globe className="w-4 h-4 text-muted" />
                  <div>
                    <div className="font-medium text-sm">Open a web page</div>
                    <div className="text-xs text-faint">Articles, docs, blog posts</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
