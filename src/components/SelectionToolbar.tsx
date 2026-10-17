import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Copy, Highlighter, MessageCircleQuestion, NotebookPen, Eraser, Search } from "lucide-react";
import type { Highlight } from "../lib/documents";

export type SelectionAction =
  | { type: "ask"; text: string; page?: number }
  | { type: "note"; text: string; page?: number }
  | { type: "highlight"; text: string; page: number; rects: Highlight["rects"] }
  | { type: "unhighlight"; ids: string[] };

interface Sel {
  text: string;
  page?: number;
  /** Set when the selection is on a PDF page (Pages view), so it can be highlighted. */
  rects?: Highlight["rects"];
  overlapping: string[];
  x: number;
  top: number;
  bottom: number;
}

interface SelectionToolbarProps {
  rootRef: RefObject<HTMLElement | null>;
  /** Page number for a passage index (Text view). */
  pageOfIndex: (index: number) => number | undefined;
  highlights: Highlight[];
  onAction: (action: SelectionAction) => void;
}

/** Merges the many small rects of a selection into one per line, as fractions of the page. */
function pageRects(range: Range, surface: Element): Highlight["rects"] {
  const box = surface.getBoundingClientRect();
  const raw = [...range.getClientRects()]
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: typeof raw = [];
  for (const r of raw) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - r.top) < 3 && r.left - last.right < 6) {
      last.right = Math.max(last.right, r.right);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else lines.push({ ...r });
  }
  return lines.map((r) => ({
    x: (r.left - box.left) / box.width,
    y: (r.top - box.top) / box.height,
    w: (r.right - r.left) / box.width,
    h: (r.bottom - r.top) / box.height,
  }));
}

const overlaps = (a: Highlight["rects"], b: Highlight["rects"]) =>
  a.some((r) => b.some((s) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h));

/** A small floating toolbar for selected text: copy, ask the agent, add to notes, highlight. */
export function SelectionToolbar({ rootRef, pageOfIndex, highlights, onAction }: SelectionToolbarProps) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const read = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) return setSel(null);
      const range = s.getRangeAt(0);
      const text = s.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2 || !root.contains(range.commonAncestorContainer)) return setSel(null);
      const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as Element | null;
      const surface = startEl?.closest("[data-page-surface]");
      const rect = range.getBoundingClientRect();
      let page: number | undefined;
      let rects: Highlight["rects"] | undefined;
      let overlapping: string[] = [];
      if (surface) {
        page = Number(surface.getAttribute("data-page-surface"));
        rects = pageRects(range, surface);
        overlapping = highlightsRef.current.filter((h) => h.page === page && overlaps(h.rects, rects!)).map((h) => h.id);
      } else {
        const idx = Number(startEl?.closest("[data-index]")?.getAttribute("data-index"));
        if (!Number.isNaN(idx)) page = pageOfIndex(idx);
      }
      setCopied(false);
      setSel({ text, page, rects, overlapping, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
    };

    const onUp = () => setTimeout(read, 10);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") onUp();
    };
    const onDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setSel(null);
    };
    const onScroll = () => setSel(null);

    root.addEventListener("mouseup", onUp);
    root.addEventListener("touchend", onUp);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onDown);
    root.addEventListener("scroll", onScroll, true);
    return () => {
      root.removeEventListener("mouseup", onUp);
      root.removeEventListener("touchend", onUp);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onDown);
      root.removeEventListener("scroll", onScroll, true);
    };
  }, [rootRef, pageOfIndex]);

  if (!sel) return null;

  const done = (action: SelectionAction) => {
    onAction(action);
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const above = sel.top > 70;
  const style = {
    left: Math.min(Math.max(sel.x, 160), window.innerWidth - 160),
    top: above ? sel.top - 8 : sel.bottom + 8,
    transform: `translate(-50%, ${above ? "-100%" : "0"})`,
  };

  return (
    // Outer element positions; inner one animates (an animation's transform would override the offset).
    <div ref={barRef} className="fixed z-50" style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="panel rounded-xl p-1 flex items-center gap-0.5 rise font-sans" style={{ background: "var(--surface)" }}>
      {sel.rects && sel.page !== undefined &&
        (sel.overlapping.length ? (
          <button className="btn h-8 text-xs px-2.5" onClick={() => done({ type: "unhighlight", ids: sel.overlapping })} title="Remove highlight">
            <Eraser className="w-3.5 h-3.5" /> Remove
          </button>
        ) : (
          <button
            className="btn h-8 text-xs px-2.5"
            onClick={() => done({ type: "highlight", text: sel.text, page: sel.page!, rects: sel.rects! })}
            title="Highlight"
          >
            <Highlighter className="w-3.5 h-3.5 text-[#e0b100]" /> Highlight
          </button>
        ))}
      <button
        className="btn h-8 text-xs px-2.5"
        onClick={() => {
          void navigator.clipboard.writeText(sel.text);
          setCopied(true);
          setTimeout(() => setSel(null), 600);
        }}
        title="Copy"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-live" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy"}
      </button>
      <button className="btn h-8 text-xs px-2.5" onClick={() => done({ type: "ask", text: sel.text, page: sel.page })} title="Ask the agent about this">
        <MessageCircleQuestion className="w-3.5 h-3.5" /> Ask
      </button>
      <button
        className="btn h-8 text-xs px-2.5"
        onClick={() => {
          window.open(`https://www.google.com/search?q=${encodeURIComponent(sel.text.slice(0, 300))}`, "_blank", "noopener");
          window.getSelection()?.removeAllRanges();
          setSel(null);
        }}
        title="Look it up on Google (new tab)"
      >
        <Search className="w-3.5 h-3.5" /> Google
      </button>
      <button className="btn h-8 text-xs px-2.5" onClick={() => done({ type: "note", text: sel.text, page: sel.page })} title="Save to notes">
        <NotebookPen className="w-3.5 h-3.5" /> Note
      </button>
      </div>
    </div>
  );
}
