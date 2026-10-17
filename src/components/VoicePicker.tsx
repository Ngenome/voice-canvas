import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, Loader2, Play, Square, X } from "lucide-react";

export interface VoiceOption {
  id: string;
  name: string;
  category?: string;
  previewUrl?: string;
  gender?: string;
  accent?: string;
  useCase?: string;
  description?: string;
}

interface VoicePickerProps {
  voiceId: string | null;
  speed: number;
  live: boolean;
  onChange: (voiceId: string | null, speed: number) => void;
  /** Reconnect so the change takes effect mid-call (the conversation carries over). */
  onApplyNow: () => void;
  /** Open upward (dock at the bottom) or downward (rail at the top). */
  placement?: "down" | "up";
}

let voicesPromise: Promise<VoiceOption[]> | null = null;
function fetchVoices() {
  voicesPromise ??= fetch("/api/voices")
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't load voices");
      return d.voices as VoiceOption[];
    })
    .catch((e) => {
      voicesPromise = null;
      throw e;
    });
  return voicesPromise;
}

const shortName = (name: string) => name.split(" - ")[0];

export function VoicePicker({ voiceId, speed, live, onChange, onApplyNow, placement = "down" }: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchVoices().then(setVoices, (e) => setError(e.message));
  }, []);

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

  useEffect(() => () => audioRef.current?.pause(), []);

  const preview = (v: VoiceOption) => {
    audioRef.current?.pause();
    if (playing === v.id || !v.previewUrl) {
      setPlaying(null);
      return;
    }
    const a = new Audio(v.previewUrl);
    a.playbackRate = speed;
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    setPlaying(v.id);
    a.play().catch(() => setPlaying(null));
  };

  const current = voices?.find((v) => v.id === voiceId);
  const change = (id: string | null, s: number) => {
    onChange(id, s);
    if (live) setPendingApply(true);
  };

  return (
    <div ref={rootRef}>
      <button className="btn h-8 text-xs px-2.5 btn-quiet max-w-[11rem]" onClick={() => setOpen((o) => !o)} title="Change the agent's voice and speed">
        <AudioLines className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{current ? shortName(current.name) : "Default voice"}</span>
        {speed !== 1 && <span className="text-faint">{speed.toFixed(2).replace(/0$/, "")}×</span>}
      </button>

      {open && (
        <div
          className={`absolute left-0 right-0 z-50 panel rounded-2xl overflow-hidden rise ${placement === "up" ? "bottom-full mb-2" : "top-full mt-2"}`}
          style={{ background: "var(--surface)" }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-sm font-medium">Voice</span>
            <button className="btn btn-icon h-7 w-7 -mr-1.5" onClick={() => setOpen(false)} title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-xs text-muted mb-1.5">
              <span>Speaking speed</span>
              <span className="font-mono">{speed.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={1.2}
              step={0.05}
              value={speed}
              onChange={(e) => change(voiceId, Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
              aria-label="Speaking speed"
            />
            <div className="flex justify-between text-[0.65rem] text-faint mt-0.5">
              <span>Slower</span>
              <span>Normal</span>
              <span>Faster</span>
            </div>
          </div>

          <div className="max-h-[18rem] overflow-y-auto border-t border-line py-1">
            {error ? (
              <p className="px-4 py-6 text-sm text-danger">{error}</p>
            ) : !voices ? (
              <div className="py-8 flex justify-center text-faint">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              [{ id: "", name: "Agent's default voice" } as VoiceOption, ...voices].map((v) => {
                const selected = (v.id || null) === voiceId;
                const meta = [v.gender, v.accent, v.description].filter(Boolean).join(" · ");
                return (
                  <div
                    key={v.id || "default"}
                    role="option"
                    aria-selected={selected}
                    tabIndex={0}
                    onClick={() => change(v.id || null, speed)}
                    onKeyDown={(e) => e.key === "Enter" && change(v.id || null, speed)}
                    className={`group flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-raised ${selected ? "bg-raised" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate flex items-center gap-1.5">
                        {shortName(v.name)}
                        {selected && <Check className="w-3.5 h-3.5 text-accent" />}
                      </div>
                      {(meta || v.name.includes(" - ")) && (
                        <div className="text-xs text-faint truncate">{v.name.includes(" - ") ? v.name.split(" - ")[1] : meta}</div>
                      )}
                    </div>
                    {v.previewUrl && (
                      <button
                        className="btn btn-icon h-7 w-7 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          preview(v);
                        }}
                        title={playing === v.id ? "Stop preview" : "Play a sample"}
                      >
                        {playing === v.id ? <Square className="w-3 h-3" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

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
