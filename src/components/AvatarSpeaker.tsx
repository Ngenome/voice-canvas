import React from "react";

export type SpeakerState = "idle" | "connecting" | "listening" | "speaking";

export const AGENT_NAME = "Voice Agent";
export const AGENT_AVATAR =
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=480&h=480&q=80";

interface AvatarSpeakerProps {
  state: SpeakerState;
  level: number;
}

export const AvatarSpeaker: React.FC<AvatarSpeakerProps> = ({ state, level }) => {
  const isSpeaking = state === "speaking";
  const isListening = state === "listening";
  const isConnecting = state === "connecting";
  const isActive = isSpeaking || isListening;

  const dynamicScale = 1 + (isSpeaking ? level * 0.12 : 0);

  return (
    <div className="relative flex items-center justify-center w-28 h-28 my-1">
      {/* Soft Ambient Blur Layer */}
      <div
        aria-hidden
        className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${
          isSpeaking
            ? "opacity-90 bg-gradient-to-tr from-indigo-500 via-sky-400 to-emerald-400"
            : isListening
            ? "opacity-60 bg-gradient-to-tr from-sky-500 to-indigo-600"
            : isConnecting
            ? "opacity-40 bg-amber-500"
            : "opacity-20 bg-indigo-500/50"
        }`}
        style={{
          transform: `scale(${1 + level * 0.35})`,
        }}
      />

      {/* Reactive Pulsing Rings */}
      {isActive && (
        <div
          aria-hidden
          className="absolute w-32 h-32 rounded-full border border-sky-400/30"
          style={{ animation: "orbRing 2.4s cubic-bezier(0.2, 0, 0, 1) infinite" }}
        />
      )}

      {/* Main Avatar Orb */}
      <div
        className={`relative w-24 h-24 overflow-hidden rounded-full shadow-2xl transition-all ease-out ${
          isSpeaking
            ? "ring-2 ring-sky-400 shadow-sky-500/30"
            : isListening
            ? "ring-2 ring-indigo-400/70 shadow-indigo-500/20"
            : isConnecting
            ? "ring-2 ring-amber-400/60 animate-pulse"
            : "ring-1 ring-white/10"
        }`}
        style={{
          transform: `scale(${dynamicScale})`,
          transitionDuration: "140ms",
        }}
      >
        <img
          src={AGENT_AVATAR}
          alt={AGENT_NAME}
          className="w-full h-full object-cover"
        />

        {/* Ambient Gloss Highlight */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-white/15 pointer-events-none" />
      </div>

      <style>{`
        @keyframes orbRing {
          0%   { transform: scale(0.85); opacity: 0.8; }
          60%  { transform: scale(1.25); opacity: 0.15; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
};
