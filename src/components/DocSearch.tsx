import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

export interface SearchMatch {
  /** Passage index. */
  index: number;
  page?: number;
  /** Character offset of the match within the passage. */
  start: number;
  before: string;
  match: string;
  after: string;
}

interface DocSearchProps {
  query: string;
  onQuery: (q: string) => void;
  matches: SearchMatch[];
  /** True when the match list was cut short. */
  capped: boolean;
  active: number;
  onPick: (i: number) => void;
  onClose: () => void;
}

/** The reader's own find bar: searches the whole document, not just what's on screen. */
export function DocSearch({ query, onQuery, matches, capped, active, onPick, onClose }: DocSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [showList, setShowList] = useState(true);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Keep the active result visible in the list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-result="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const n = matches.length;
  // Stepping through matches tucks the list away so it doesn't cover the text.
  const next = () => {
    if (!n) return;
    setShowList(false);
    onPick((active + 1) % n);
  };
  const prev = () => {
    if (!n) return;
    setShowList(false);
    onPick((active - 1 + n) % n);
  };

  return (
    <div className="absolute right-4 top-3 z-30 w-[min(26rem,calc(100%-2rem))] panel rounded-xl rise font-sans" style={{ background: "var(--surface)" }}>
      <div className="flex items-center gap-1.5 p-1.5">
        <Search className="w-4 h-4 text-faint ml-1.5 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setShowList(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) prev();
              else next();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              next();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              prev();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search this document"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm py-1.5"
          aria-label="Search this document"
        />
        <span className="text-xs text-faint tabular-nums whitespace-nowrap px-1">
          {query.trim().length < 2 ? "" : n === 0 ? "No matches" : `${active + 1} of ${n}${capped ? "+" : ""}`}
        </span>
        <button className="btn btn-icon h-7 w-7" onClick={prev} disabled={!n} title="Previous (Shift+Enter)">
          <ChevronUp className="w-4 h-4" />
        </button>
        <button className="btn btn-icon h-7 w-7" onClick={next} disabled={!n} title="Next (Enter)">
          <ChevronDown className="w-4 h-4" />
        </button>
        <button className="btn btn-icon h-7 w-7" onClick={onClose} title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </div>

      {showList && n > 0 && (
        <div ref={listRef} className="max-h-[min(20rem,50vh)] overflow-y-auto border-t border-line py-1">
          {matches.map((m, i) => (
            <button
              key={`${m.index}-${m.start}`}
              data-result={i}
              onClick={() => onPick(i)}
              className={`w-full text-left px-3 py-1.5 flex gap-3 hover:bg-raised ${i === active ? "bg-raised" : ""}`}
            >
              <span className="text-[0.7rem] text-faint w-12 flex-shrink-0 pt-0.5 tabular-nums">{m.page ? `p. ${m.page}` : `#${m.index + 1}`}</span>
              <span className="text-xs text-muted leading-relaxed min-w-0">
                {m.before}
                <mark className="search-mark">{m.match}</mark>
                {m.after}
              </span>
            </button>
          ))}
        </div>
      )}
      {n > 0 && (
        <button className="w-full text-[0.7rem] text-faint py-1 border-t border-line hover:text-fg" onClick={() => setShowList((v) => !v)}>
          {showList ? "Hide results" : `Show all ${n} results`}
        </button>
      )}
    </div>
  );
}
