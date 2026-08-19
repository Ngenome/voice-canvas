import { useState, useEffect, useCallback } from "react";
import {
  Mic,
  Settings,
  History,
  Plus,
  Radio,
} from "lucide-react";
import VoiceChat, { type ResumedSessionData } from "./components/VoiceChat";
import { SessionHistory, type SessionItem, type TranscriptItem } from "./components/SessionHistory";
import { SettingsModal } from "./components/SettingsModal";
import type { CanvasEntry } from "./components/CanvasPanel";

function parseCanvasEntries(raw: unknown): CanvasEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as CanvasEntry[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as CanvasEntry[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getSessionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/session\/(.*?)\/?$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1] || "");
  return id.length > 0 ? id : null;
}

export function App() {
  const [agentId, setAgentId] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [resumedSession, setResumedSession] = useState<ResumedSessionData | null>(null);

  const navigateToSessionPath = useCallback((sessionId: string, replace = false) => {
    const url = `/session/${encodeURIComponent(sessionId)}`;
    if (replace) {
      window.history.replaceState({}, "", url);
    } else {
      window.history.pushState({}, "", url);
    }
  }, []);

  const clearResumedSession = useCallback(() => {
    setCurrentSessionId("");
    setResumedSession(null);
    if (window.location.pathname !== "/") {
      window.history.pushState({}, "", "/");
    }
  }, []);

  const hydrateSessionFromId = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!res.ok) {
          clearResumedSession();
          return;
        }

        const data = await res.json();
        const session = data.session as
          | (SessionItem & { canvas_json?: string; transcripts: TranscriptItem[] })
          | null;

        if (!session) {
          clearResumedSession();
          return;
        }

        setCurrentSessionId(session.id);
        setResumedSession({
          id: session.id,
          title: session.title,
          transcripts: (session.transcripts || []).map((t) => ({ role: t.role, message: t.message })),
          canvasEntries: parseCanvasEntries(session.canvas_json),
        });
      } catch {
        clearResumedSession();
      }
    },
    [clearResumedSession],
  );

  const hydrateFromCurrentRoute = useCallback(async () => {
    const sessionId = getSessionIdFromPath(window.location.pathname);
    if (!sessionId) {
      clearResumedSession();
      return;
    }

    await hydrateSessionFromId(sessionId);
  }, [clearResumedSession, hydrateSessionFromId]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          if (data.settings.agent_id) setAgentId(data.settings.agent_id);
          if (data.settings.api_key) setApiKey(data.settings.api_key);
        }
      }
    } catch (err) {
      console.error("Could not fetch settings:", err);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    hydrateFromCurrentRoute();

    const onPopState = () => {
      void hydrateFromCurrentRoute();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hydrateFromCurrentRoute, fetchSettings]);

  const handleResumeSession = (
    session: SessionItem,
    transcripts: TranscriptItem[],
    canvasEntries: CanvasEntry[] = [],
  ) => {
    setCurrentSessionId(session.id);
    setResumedSession({
      id: session.id,
      title: session.title,
      transcripts: transcripts.map((t) => ({ role: t.role, message: t.message })),
      canvasEntries,
    });
    navigateToSessionPath(session.id, false);
  };

  return (
    <div className="min-h-screen h-screen max-h-screen flex flex-col text-zinc-100 selection:bg-sky-500 selection:text-zinc-950 overflow-hidden font-sans">
      {/* Sleek Top Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#09090b]/80 backdrop-blur-2xl px-5 py-2.5 flex-shrink-0">
        <div className="max-w-full mx-auto flex items-center justify-between gap-4">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-sky-400 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-tight text-white uppercase tracking-wider">
                  ElevenLabs Voice Canvas
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700/60 hidden sm:inline-block">
                  Studio
                </span>
              </div>
            </div>
          </div>

          {/* Center Context / Active Breadcrumb */}
          {resumedSession && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full surface-pill text-xs text-zinc-300">
              <Radio className="w-3 h-3 text-sky-400 animate-pulse" />
              <span className="max-w-xs truncate font-medium">{resumedSession.title}</span>
            </div>
          )}

          {/* Right Action Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={clearResumedSession}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl surface-pill text-zinc-200 hover:text-white text-xs font-medium transition cursor-pointer"
              title="Start a new clean chat session"
            >
              <Plus className="w-3.5 h-3.5 text-zinc-400" />
              <span>New Session</span>
            </button>

            <button
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl surface-pill text-zinc-200 hover:text-white text-xs font-medium transition cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-zinc-400" />
              <span>History</span>
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-xl surface-pill text-zinc-400 hover:text-white transition cursor-pointer"
              title="Agent Settings & API Keys"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workstation Viewport */}
      <main className="flex-1 w-full p-4 h-[calc(100vh-55px)] min-h-0 overflow-hidden">
        <VoiceChat
          agentId={agentId}
          apiKey={apiKey}
          resumedSession={resumedSession}
          onSessionSaved={(id) => {
            setCurrentSessionId(id);
            setResumedSession(null);
            navigateToSessionPath(id, true);
          }}
          openSettings={() => setIsSettingsOpen(true)}
        />
      </main>

      {/* Slide-over Drawers & Dialogs */}
      <SessionHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        currentSessionId={currentSessionId}
        onResumeSession={handleResumeSession}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        agentId={agentId}
        setAgentId={setAgentId}
        apiKey={apiKey}
        setApiKey={setApiKey}
        onSave={() => {
          fetchSettings();
        }}
      />
    </div>
  );
}

export default App;
