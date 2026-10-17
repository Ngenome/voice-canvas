export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "paused";

interface OrbProps {
  state: OrbState;
  level: number;
  size?: number;
}

/** A soft, breathing light that reflects what the agent is doing. */
export function Orb({ state, level, size = 44 }: OrbProps) {
  const speaking = state === "speaking";
  const listening = state === "listening";
  const live = speaking || listening;
  const scale = 1 + (speaking ? Math.min(level, 1) * 0.28 : listening ? Math.min(level, 1) * 0.12 : 0);

  const core =
    state === "paused"
      ? "radial-gradient(circle at 35% 30%, var(--raised), var(--sunken))"
      : state === "idle"
      ? "radial-gradient(circle at 35% 30%, #f0dcb8, #b88445 60%, #5e3e18)"
      : state === "connecting"
      ? "radial-gradient(circle at 35% 30%, #f3d9a8, var(--accent))"
      : speaking
      ? "radial-gradient(circle at 35% 30%, #fff1d6, var(--accent) 55%, #9a5a1a)"
      : "radial-gradient(circle at 35% 30%, #f6ead6, #c99a5b 60%, #6f4a1f)";

  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }} aria-hidden>
      {live && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--accent)",
            filter: "blur(10px)",
            opacity: speaking ? 0.55 : 0.25,
            transform: `scale(${scale * 1.1})`,
            transition: "transform 120ms ease-out, opacity 300ms ease",
          }}
        />
      )}
      {state === "connecting" && (
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "var(--accent)", filter: "blur(8px)", animation: "breathe 1.4s ease-in-out infinite" }}
        />
      )}
      <div
        className="relative rounded-full"
        style={{
          width: size,
          height: size,
          background: core,
          border: "1px solid var(--line-strong)",
          transform: `scale(${scale})`,
          transition: "transform 120ms ease-out, background 400ms ease",
          animation: state === "idle" ? "breathe 5s ease-in-out infinite" : undefined,
        }}
      />
    </div>
  );
}
