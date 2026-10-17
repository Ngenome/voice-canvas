import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CaptionEngine } from "../lib/captions";

interface CaptionsProps {
  engine: CaptionEngine;
  /** Distance from the bottom of its container, to clear docks and pills. */
  bottom: string;
}

/**
 * Subtitle-style captions for the agent's voice.
 * A fixed one-line strip, left-aligned so lines never re-center. Whole words fade in as
 * they're spoken, and when a line fills the text glides up instead of jumping.
 */
export function Captions({ engine, bottom }: CaptionsProps) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const prevHeightRef = useRef(0);

  useEffect(
    () =>
      engine.subscribe((t, a, p) => {
        setText(t);
        setActive(a);
        setPending(p);
      }),
    [engine],
  );

  // Only show finished words; the word being spoken appears once its last letter has played.
  const tokens = text.split(/\s+/).filter(Boolean);
  const midWord = pending && text.length > 0 && !/\s$/.test(text);
  const words = midWord ? tokens.slice(0, -1) : tokens;

  // Glide up smoothly when a new line pushes the text (FLIP: jump, then animate back to rest).
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const grew = h - prevHeightRef.current;
    prevHeightRef.current = h;
    if (grew > 0 && grew < 80) {
      el.style.transition = "none";
      el.style.transform = `translateY(${grew}px)`;
      void el.offsetHeight; // apply the jump before animating
      el.style.transition = "transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1)";
      el.style.transform = "translateY(0)";
    }
  }, [words.length]);

  const visible = active && words.length > 0;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-30 w-[min(44rem,calc(100%-2rem))] transition-[opacity,transform] duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
      style={{ bottom }}
    >
      <div
        className="rounded-lg px-3.5 py-[0.35rem]"
        style={{
          background: "rgba(10, 8, 6, 0.74)",
          backdropFilter: "blur(6px)",
          // A touch smaller than body text, never below ~14px.
          fontSize: "clamp(0.88rem, 0.84rem + 0.2vw, 0.97rem)",
        }}
      >
        {/* A window exactly one line tall; finished lines glide out the top with a soft fade. */}
        <div
          className="relative overflow-hidden"
          style={{
            height: "1.5em",
            maskImage: "linear-gradient(to bottom, transparent 0, #000 0.25em)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 0.25em)",
          }}
        >
          <div ref={innerRef} className="absolute inset-x-0 bottom-0 text-white font-sans text-left" style={{ lineHeight: 1.5 }}>
            {words.map((w, i) => (
              <span key={i} className="caption-word">
                {w}{" "}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
