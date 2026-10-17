import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Globe, Plus, RefreshCw, Trash2, Type } from "lucide-react";
import { groupOf, shelfGroups, versionOfDoc, versionsOf, type ReadingDocument } from "../lib/documents";

interface DocSwitcherProps {
  docs: ReadingDocument[];
  active: ReadingDocument;
  /** "34% through · page 12 of 34" */
  subtitle: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onNewVersion: (baseId: string) => void;
  onRemove: (id: string) => void;
}

const icon = (d: ReadingDocument, cls = "w-3.5 h-3.5 flex-shrink-0") =>
  d.source === "pdf" ? <FileText className={cls} /> : d.source === "web" ? <Globe className={cls} /> : <Type className={cls} />;

/** The document title doubles as the switcher: documents in this session, versions, add, replace, remove. */
export function DocSwitcher({ docs, active, subtitle, onSwitch, onAdd, onNewVersion, onRemove }: DocSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groups = shelfGroups(docs.length ? docs : [active]);
  const versions = versionsOf(docs.length ? docs : [active], active);
  const isLatest = versions[versions.length - 1]?.id === active.id;

  useEffect(() => {
    if (!open) return;
    setConfirmRemove(false);
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

  const pick = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-full">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden text-left rounded-lg px-1.5 -mx-1.5 py-0.5 hover:bg-raised"
        title={`${active.title}: documents in this session`}
      >
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-serif text-[1rem] font-semibold leading-tight truncate">{active.title}</span>
            {versions.length > 1 && (
              <span className={`px-1.5 rounded text-[0.62rem] font-semibold flex-shrink-0 ${isLatest ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"}`}>
                v{versionOfDoc(active)}
              </span>
            )}
            {groups.length > 1 && <span className="text-[0.65rem] text-faint flex-shrink-0">+{groups.length - 1}</span>}
            <ChevronDown className="w-3.5 h-3.5 text-faint flex-shrink-0" />
          </div>
          <div className="text-[0.72rem] text-faint truncate">{subtitle}</div>
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 w-[19rem] panel rounded-xl overflow-hidden rise text-sm" style={{ background: "var(--surface)" }}>
          <div className="eyebrow px-3 pt-2.5 pb-1">In this session</div>
          <div className="pb-1 max-h-[45vh] overflow-y-auto">
            {groups.map((vs) => {
              const latest = vs[vs.length - 1];
              const isActiveGroup = groupOf(latest) === groupOf(active);
              return (
                <button
                  key={groupOf(latest)}
                  onClick={pick(() => onSwitch(isActiveGroup ? active.id : latest.id))}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-raised ${isActiveGroup ? "bg-raised" : ""}`}
                >
                  {icon(latest, "w-4 h-4 flex-shrink-0 text-muted")}
                  <span className="flex-1 min-w-0 truncate">{latest.title}</span>
                  {vs.length > 1 && <span className="text-[0.65rem] text-faint">{vs.length} versions</span>}
                  {isActiveGroup && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          {versions.length > 1 && (
            <div className="border-t border-line py-1">
              <div className="eyebrow px-3 pt-1.5 pb-1">Versions of this document</div>
              {[...versions].reverse().map((v, i) => (
                <button key={v.id} onClick={pick(() => onSwitch(v.id))} className="w-full text-left px-3 py-1.5 hover:bg-raised flex items-center gap-2">
                  <span className="w-7 text-xs font-semibold">v{versionOfDoc(v)}</span>
                  <span className="text-xs text-faint flex-1">
                    {i === 0 ? "Latest" : new Date(v.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                  {v.id === active.id && <Check className="w-3.5 h-3.5 text-accent" />}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-line py-1">
            <button onClick={pick(onAdd)} className="w-full text-left px-3 py-2 hover:bg-raised flex items-center gap-2.5">
              <Plus className="w-4 h-4 text-muted" /> Add a document
            </button>
            <button onClick={pick(() => onNewVersion(versions[versions.length - 1]?.id ?? active.id))} className="w-full text-left px-3 py-2 hover:bg-raised flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 text-muted" /> Replace with newer version
            </button>
            {confirmRemove ? (
              <div className="px-3 py-2 flex items-center gap-2">
                <span className="text-xs text-muted flex-1">Remove “{active.title}”{versions.length > 1 ? " (all versions)" : ""} and its highlights?</span>
                <button className="btn btn-danger h-7 text-xs" onClick={pick(() => onRemove(active.id))}>
                  Remove
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmRemove(true)} className="w-full text-left px-3 py-2 hover:bg-raised flex items-center gap-2.5 text-danger">
                <Trash2 className="w-4 h-4" /> Remove from this session
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
