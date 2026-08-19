import React from "react";

interface WaveformProps {
  level: number;
  active: boolean;
  bars?: number;
  className?: string;
}

export const Waveform: React.FC<WaveformProps> = ({
  level,
  active,
  bars = 24,
  className = "",
}) => {
  const amp = active ? 0.35 + Math.min(1, level * 2.8) * 0.9 : 0.15;

  return (
    <div
      className={`flex h-6 items-center justify-center gap-[3px] ${className}`}
      aria-hidden
      style={{
        transform: `scaleY(${amp})`,
        transformOrigin: "center",
        transition: "transform 100ms ease-out",
      }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const t = i / (bars - 1);
        const bell = 0.25 + 0.75 * Math.sin(Math.PI * t);
        return (
          <span
            key={i}
            className={`w-[2.5px] rounded-full transition-all duration-300 ${
              active
                ? "bg-gradient-to-t from-indigo-500 via-sky-400 to-emerald-400"
                : "bg-zinc-700/60"
            }`}
            style={{
              height: `${Math.max(15, bell * 100)}%`,
              opacity: active ? 0.95 : 0.4,
              animation: active ? `pulseBar 900ms ease-in-out ${(i * 47) % 700}ms infinite` : "none",
            }}
          />
        );
      })}
      <style>{`
        @keyframes pulseBar {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1.15); }
        }
      `}</style>
    </div>
  );
};
