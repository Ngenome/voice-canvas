import { useState, useEffect, useCallback } from "react";
import { Library } from "lucide-react";
import { AppMenu } from "./components/AppMenu";
import VoiceChat, { type ResumedSessionData } from "./components/VoiceChat";
import { SessionHistory, type SessionItem, type TranscriptItem } from "./components/SessionHistory";
import { SettingsModal } from "./components/SettingsModal";
import type { CanvasEntry } from "./components/CanvasPanel";
import { parseShelf } from "./lib/documents";

type Theme = "night" | "paper";

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

function parseSummary(raw: unknown): ResumedSessionData["summary"] {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && typeof s.text === "string" && typeof s.covered === "number" ? s : null;
  } catch {
    return null;
  }
}

function getSessionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/session\/(.*?)\/?$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1] || "");
  return id.length > 0 ? id : null;
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "paper" ? "paper" : "night";
}

export function App() {
  const [agentId, setAgentId] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [resumedSession, setResumedSession] = useState<ResumedSessionData | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("vc_theme", theme);
    } catch {}
  }, [theme]);

  const navigateToSessionPath = useCallback((sessionId: string, replace = false) => {
    const url = `/session/${encodeURIComponent(sessionId)}`;
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
  }, []);

  const loadSession = useCallback((data: ResumedSessionData) => {
    setCurrentSessionId(data.id);
    setResumedSession(data);
    setChatKey((k) => k + 1);
  }, []);

  const startFresh = useCallback(() => {
    setCurrentSessionId("");
    setResumedSession(null);
    setChatKey((k) => k + 1);
    if (window.location.pathname !== "/") window.history.pushState({}, "", "/");
  }, []);

  const hydrateSessionFromId = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!res.ok) return startFresh();
        const data = await res.json();
        const session = data.session as
          | (SessionItem & { canvas_json?: string; document_json?: string; summary_json?: string; transcripts: TranscriptItem[] })
          | null;
        if (!session) return startFresh();
        loadSession({
          id: session.id,
          title: session.title,
          transcripts: (session.transcripts || []).map((t) => ({ role: t.role, message: t.message })),
          canvasEntries: parseCanvasEntries(session.canvas_json),
          shelf: parseShelf(session.document_json),
          summary: parseSummary(session.summary_json),
        });
      } catch {
        startFresh();
      }
    },
    [loadSession, startFresh],
  );

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.settings?.agent_id) setAgentId(data.settings.agent_id);
        if (data.settings?.api_key) setApiKey(data.settings.api_key);
      }
    } catch (err) {
      console.error("Could not fetch settings:", err);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
    const fromRoute = () => {
      const id = getSessionIdFromPath(window.location.pathname);
      if (id) void hydrateSessionFromId(id);
    };
    fromRoute();
    window.addEventListener("popstate", fromRoute);
    return () => window.removeEventListener("popstate", fromRoute);
  }, [hydrateSessionFromId, fetchSettings]);

  // Load through the same path as a page reload so everything (including the conversation summary) comes back.
  const handleOpenFromLibrary = (session: SessionItem) => {
    navigateToSessionPath(session.id);
    void hydrateSessionFromId(session.id);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0">
        <VoiceChat
          key={chatKey}
          agentId={agentId}
          apiKey={apiKey}
          resumedSession={resumedSession}
          onSessionSaved={(id) => {
            setCurrentSessionId(id);
            navigateToSessionPath(id, true);
          }}
          onLiveChange={setIsLive}
          openSettings={() => setIsSettingsOpen(true)}
          appActions={
            <>
              <button onClick={() => setIsLibraryOpen(true)} className="btn btn-icon" title="Library">
                <Library className="w-4 h-4" />
              </button>
              <AppMenu
                canStartNew={!isLive}
                onNew={startFresh}
                theme={theme}
                onToggleTheme={() => setTheme((t) => (t === "night" ? "paper" : "night"))}
                onSettings={() => setIsSettingsOpen(true)}
              />
            </>
          }
        />
      </main>

      <SessionHistory
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        currentSessionId={currentSessionId}
        isLive={isLive}
        onOpenSession={handleOpenFromLibrary}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        agentId={agentId}
        setAgentId={setAgentId}
        apiKey={apiKey}
        setApiKey={setApiKey}
        onSave={() => void fetchSettings()}
      />
    </div>
  );
}

export default App;
