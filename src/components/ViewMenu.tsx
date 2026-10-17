import { useEffect, useRef, useState } from "react";
import { AlignLeft, FileText, Minus, Plus, Type } from "lucide-react";

type View = "text" | "pages";
type Width = "comfortable" | "wide" | "full";

interface ViewMenuProps {
  isPdf: boolean;
  view: View;
  onView: (v: View) => void;
  widthMode: Width;
  onWidth: (w: Width) => void;
  fontStep: number;
  onFont: (fn: (s: number) => number) => void;
  showFont: boolean;
}

const FONT_MAX = 4;

/** Reading layout in one place: Text or Pages, column width, and text size. */
export function ViewMenu({ isPdf, view, onView, widthMode, onWidth, fontStep, onFont, showFont }: ViewMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const seg = (active: boolean) => `flex-1 btn h-8 text-xs ${active ? "bg-raised !text-fg shadow-sm" : ""}`;

  return (
    <div ref={rootRef} className="relative">
      <button className={`btn h-9 px-2.5 ${open ? "btn-on" : ""}`} onClick={() => setOpen((o) => !o)} title="Reading view: pages or text, width, text size">
        {isPdf && view === "pages" ? <FileText className="w-4 h-4" /> : <Type className="w-4 h-4" />}
        <span className="hidden xl:inline text-xs">{isPdf ? (view === "pages" ? "Pages" : "Text") : "View"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 panel rounded-xl p-3 space-y-3 rise" style={{ background: "var(--surface)" }}>
          {isPdf && (
            <div>
              <div className="eyebrow mb-1.5">Show</div>
              <div className="flex rounded-lg bg-sunken p-0.5">
                <button className={seg(view === "text")} onClick={() => onView("text")} title="Reflowed text, easy to read and search">
                  <AlignLeft className="w-3.5 h-3.5" /> Text
                </button>
                <button className={seg(view === "pages")} onClick={() => onView("pages")} title="The real pages, with images and diagrams">
                  <FileText className="w-3.5 h-3.5" /> Pages
                </button>
              </div>
            </div>
          )}
          <div>
            <div className="eyebrow mb-1.5">Width</div>
            <div className="flex rounded-lg bg-sunken p-0.5">
              {(["comfortable", "wide", "full"] as Width[]).map((w) => (
                <button key={w} className={seg(widthMode === w)} onClick={() => onWidth(w)}>
                  {w === "comfortable" ? "Narrow" : w === "wide" ? "Wide" : "Full"}
                </button>
              ))}
            </div>
          </div>
          {showFont && (
            <div>
              <div className="eyebrow mb-1.5">Text size</div>
              <div className="flex items-center gap-2">
                <button className="btn btn-icon btn-quiet h-8 w-8" onClick={() => onFont((s) => Math.max(0, s - 1))} disabled={fontStep === 0} title="Smaller">
                  <Minus className="w-4 h-4" />
                </button>
                <div className="flex-1 flex justify-center gap-1.5">
                  {Array.from({ length: FONT_MAX + 1 }, (_, i) => (
                    <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= fontStep ? "bg-accent" : "bg-line-strong"}`} />
                  ))}
                </div>
                <button
                  className="btn btn-icon btn-quiet h-8 w-8"
                  onClick={() => onFont((s) => Math.min(FONT_MAX, s + 1))}
                  disabled={fontStep === FONT_MAX}
                  title="Larger"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
