import { useEffect, useRef, useState } from "react";
import { Check, Cpu } from "lucide-react";

/** Models worth switching between for live conversation. All see images and support low thinking. */
export const MODELS = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Smart and well rounded, the default" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", note: "A little quicker" },
  { id: "claude-opus-5", name: "Claude Opus 5", note: "Deepest answers, slowest" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", note: "Fastest replies" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", note: "OpenAI alternative" },
] as const;

interface ModelPickerProps {
  /** null = the agent's default model. */
  model: string | null;
  live: boolean;
  onChange: (model: string | null) => void;
  /** Reconnect so the change takes effect mid-call (the conversation carries over). */
  onApplyNow: () => void;
}

export function ModelPicker({ model, live, onChange, onApplyNow }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState(false);
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

  const current = MODELS.find((m) => m.id === model) ?? MODELS[0];

  return (
    <div ref={rootRef}>
      <button className="btn h-8 text-xs px-2.5 btn-quiet max-w-[10rem]" onClick={() => setOpen((o) => !o)} title="Change the model the agent thinks with">
        <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{current.name.replace(/^Claude /, "")}</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 panel rounded-2xl overflow-hidden rise" style={{ background: "var(--surface)" }}>
          <div className="px-4 pt-3 pb-1.5 text-sm font-medium">Model</div>
          <div className="py-1">
            {MODELS.map((m) => {
              const selected = m.id === current.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onChange(m.id === MODELS[0].id ? null : m.id);
                    if (live && !selected) setPendingApply(true);
                  }}
                  className={`w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-raised ${selected ? "bg-raised" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm flex items-center gap-1.5">
                      {m.name}
                      {selected && <Check className="w-3.5 h-3.5 text-accent" />}
                    </div>
                    <div className="text-xs text-faint">{m.note}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="px-4 pb-3 pt-1 text-[0.7rem] text-faint">All use low thinking.</p>
          {live && pendingApply && (
            <div className="border-t border-line px-4 py-3 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Applies on the next call.</span>
              <button
                className="btn btn-primary h-8 text-xs"
                onClick={() => {
                  setPendingApply(false);
                  setOpen(false);
                  onApplyNow();
                }}
                title="Reconnects; the conversation carries over"
              >
                Switch now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
