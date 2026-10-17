import { useEffect, useRef, useState } from "react";
import { Moon, MoreHorizontal, Plus, Settings, Sun } from "lucide-react";

interface AppMenuProps {
  canStartNew: boolean;
  onNew: () => void;
  theme: "night" | "paper";
  onToggleTheme: () => void;
  onSettings: () => void;
}

/** Less-used app actions, tucked into one menu to keep the top bar calm. */
export function AppMenu({ canStartNew, onNew, theme, onToggleTheme, onSettings }: AppMenuProps) {
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

  const item = "w-full text-left px-3 py-2 hover:bg-raised flex items-center gap-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div ref={rootRef} className="relative">
      <button className={`btn btn-icon ${open ? "btn-on" : ""}`} onClick={() => setOpen((o) => !o)} title="More">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-56 panel rounded-xl py-1 rise" style={{ background: "var(--surface)" }}>
          <button
            className={item}
            disabled={!canStartNew}
            title={canStartNew ? undefined : "End the current call first"}
            onClick={() => {
              onNew();
              setOpen(false);
            }}
          >
            <Plus className="w-4 h-4 text-muted" /> New session
          </button>
          <button
            className={item}
            onClick={() => {
              onToggleTheme();
              setOpen(false);
            }}
          >
            {theme === "night" ? <Sun className="w-4 h-4 text-muted" /> : <Moon className="w-4 h-4 text-muted" />}
            {theme === "night" ? "Light theme" : "Dark theme"}
          </button>
          <button
            className={item}
            onClick={() => {
              onSettings();
              setOpen(false);
            }}
          >
            <Settings className="w-4 h-4 text-muted" /> Settings
          </button>
        </div>
      )}
    </div>
  );
}
