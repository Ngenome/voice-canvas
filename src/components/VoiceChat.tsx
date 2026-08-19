import React, { useState, useEffect, useRef, useCallback } from "react";
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import {
  Mic,
  MicOff,
  PhoneOff,
  PhoneCall,
  Send,
  Sparkles,
  RefreshCw,
  RotateCcw,
  Loader2,
  FileText,
  Maximize2,
  Minimize2,
  BookOpen,
  Copy,
  Check,
  Bot,
  User,
  Radio,
} from "lucide-react";
import { AvatarSpeaker, AGENT_NAME } from "./AvatarSpeaker";
import type { SpeakerState } from "./AvatarSpeaker";
import { Waveform } from "./Waveform";
import { CanvasPanel, type CanvasEntry } from "./CanvasPanel";

export interface ResumedSessionData {
  id: string;
  title: string;
  transcripts: { role: string; message: string }[];
  canvasEntries?: CanvasEntry[];
}

interface VoiceChatProps {
  agentId: string;
  apiKey: string;
  resumedSession?: ResumedSessionData | null;
  onSessionSaved?: (sessionId: string) => void;
  openSettings: () => void;
}

type Turn = { source: string; message: string };
type Phase = "idle" | "connecting" | "live" | "finishing" | "error";
type CanvasToolParams = {
  markdown?: string;
  content?: string;
  text?: string;
  source?: "agent" | "user" | "tool" | "system";
  toolName?: string;
};

function formatTimer(secs: number) {
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${mins.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function parseCanvasJson(raw: string | null): CanvasEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CanvasEntry[]) : [];
  } catch {
    return [];
  }
}

function canvasBackupKey(sessionId: string): string {
  return `voicechat_canvas_${sessionId}`;
}

/** Inner component — must live inside ConversationProvider */
function VoiceChatInner({
  agentId,
  apiKey,
  resumedSession,
  onSessionSaved,
  openSettings,
}: VoiceChatProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [isExpandedText, setIsExpandedText] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [canvasEntries, setCanvasEntries] = useState<CanvasEntry[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const canvasRef = useRef<CanvasEntry[]>(canvasEntries);
  canvasRef.current = canvasEntries;
  const sessionIdRef = useRef<string | null>(null);
  const finalizedRef = useRef(false);
  const transcriptRef = useRef<Turn[]>([]);
  transcriptRef.current = transcript;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const resumedRef = useRef(resumedSession);
  resumedRef.current = resumedSession;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const persistCanvasEntries = useCallback((entries: CanvasEntry[]) => {
    let activeId = sessionIdRef.current;
    if (!activeId) {
      activeId = `sess_${Date.now()}`;
      sessionIdRef.current = activeId;
    }

    try {
      localStorage.setItem(canvasBackupKey(activeId), JSON.stringify(entries));
    } catch {}

    void fetch(`/api/sessions/${encodeURIComponent(activeId)}/canvas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canvas_entries: entries,
        canvas_json: JSON.stringify(entries),
      }),
    }).catch(() => {});
  }, []);

  // 1. Append entry to canvas
  const handleAppendCanvas = useCallback(
    ({ markdown, content, text, source = "agent", toolName = "append_to_canvas" }: CanvasToolParams) => {
      const payload = (markdown || content || text || "").trim();
      if (!payload) return "Error: No text or markdown content provided.";

      const newEntry: CanvasEntry = {
        id: `canv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        markdown: payload,
        source,
        createdAt: new Date().toISOString(),
        toolName,
      };

      setCanvasEntries((prev) => {
        const next = [...prev, newEntry];
        persistCanvasEntries(next);
        return next;
      });

      showToast(`Canvas updated by AI agent.`);
      return `Canvas entry added successfully (ID: ${newEntry.id}).`;
    },
    [persistCanvasEntries],
  );

  // 2. Overwrite entire canvas
  const handleWriteCanvas = useCallback(
    ({ markdown, content, text, source = "agent", toolName = "write_to_canvas" }: CanvasToolParams) => {
      const payload = (markdown || content || text || "").trim();
      const newEntry: CanvasEntry = {
        id: `canv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        markdown: payload,
        source,
        createdAt: new Date().toISOString(),
        toolName,
      };

      const next = payload ? [newEntry] : [];
      setCanvasEntries(next);
      persistCanvasEntries(next);

      showToast(payload ? "Canvas replaced with new entry." : "Canvas cleared.");
      return "Canvas state updated successfully.";
    },
    [persistCanvasEntries],
  );

  // 3. List lightweight manifest of all canvas entries with IDs and titles
  const handleListCanvasEntries = useCallback(() => {
    const current = canvasRef.current;
    if (current.length === 0) {
      return "The canvas is currently empty (0 entries).";
    }

    const items = current.map((entry, idx) => {
      // Extract title from first line / heading
      const firstLine = entry.markdown.split("\n")[0].replace(/^[#\s*-_]+/, "").trim() || "Untitled Note";
      const snippet = entry.markdown.replace(/\n+/g, " ").substring(0, 70);
      return `[Index: ${idx + 1}] ID: "${entry.id}" | Title: "${firstLine}" | Preview: "${snippet}..."`;
    });

    return `CANVAS ENTRIES MANIFEST (${current.length} items):\n` + items.join("\n");
  }, []);

  // 4. Read full markdown of all cards or a specific card by ID
  const handleReadCanvas = useCallback((params?: { id?: string }) => {
    const current = canvasRef.current;
    if (current.length === 0) {
      return "The canvas is currently empty.";
    }

    if (params?.id) {
      const found = current.find((e) => e.id === params.id);
      if (found) {
        return `[Card ID: ${found.id}]\n${found.markdown}`;
      }
      return `Card with ID "${params.id}" was not found. Call list_canvas_entries to see available IDs.`;
    }

    const summary = current
      .map((entry, idx) => `[Card ${idx + 1} | ID: ${entry.id}]\n${entry.markdown}`)
      .join("\n\n---\n\n");

    return `CURRENT CANVAS CONTENTS (${current.length} cards):\n\n${summary}`;
  }, []);

  // 5. Update specific existing canvas entry in place
  const handleUpdateCanvasEntry = useCallback(
    (params: { id?: string; targetTitle?: string; markdown?: string; content?: string }) => {
      const newMarkdown = (params.markdown || params.content || "").trim();
      if (!newMarkdown) return "Error: No updated markdown provided.";

      let updated = false;
      const current = canvasRef.current;

      const next = current.map((entry) => {
        const matchesId = params.id && entry.id === params.id;
        const matchesTitle =
          params.targetTitle &&
          entry.markdown.toLowerCase().includes(params.targetTitle.toLowerCase());

        if (!updated && (matchesId || matchesTitle)) {
          updated = true;
          return {
            ...entry,
            markdown: newMarkdown,
            createdAt: new Date().toISOString(),
            toolName: "update_canvas_entry",
          };
        }
        return entry;
      });

      if (!updated) {
        // If not found, append as new entry
        return handleAppendCanvas({ markdown: newMarkdown, toolName: "update_canvas_entry" });
      }

      setCanvasEntries(next);
      persistCanvasEntries(next);
      showToast("Canvas section updated in place.");
      return "Canvas entry updated successfully.";
    },
    [handleAppendCanvas, persistCanvasEntries],
  );

  // 6. Delete specific canvas entry
  const handleDeleteCanvasEntry = useCallback(
    (params: { id?: string; targetTitle?: string } | string) => {
      const targetId = typeof params === "string" ? params : params?.id;
      const targetTitle = typeof params === "object" ? params?.targetTitle : undefined;

      const current = canvasRef.current;
      const next = current.filter((entry) => {
        if (targetId && entry.id === targetId) return false;
        if (targetTitle && entry.markdown.toLowerCase().includes(targetTitle.toLowerCase())) {
          return false;
        }
        return true;
      });

      setCanvasEntries(next);
      persistCanvasEntries(next);
      showToast("Canvas section deleted.");
      return "Canvas entry deleted successfully.";
    },
    [persistCanvasEntries],
  );

  // Register all Client Tools with ElevenLabs WebSocket
  useConversationClientTool("list_canvas_entries", () => {
    return handleListCanvasEntries();
  });

  useConversationClientTool("read_canvas", (params: any) => {
    return handleReadCanvas(params);
  });

  useConversationClientTool("append_to_canvas", (params: CanvasToolParams) => {
    return handleAppendCanvas(params);
  });

  useConversationClientTool("write_to_canvas", (params: CanvasToolParams) => {
    return handleWriteCanvas(params);
  });

  useConversationClientTool("append_markdown", (params: CanvasToolParams) => {
    return handleAppendCanvas({ ...params, toolName: "append_markdown" });
  });

  useConversationClientTool("update_canvas_entry", (params: any) => {
    return handleUpdateCanvasEntry(params);
  });

  useConversationClientTool("delete_canvas_entry", (params: any) => {
    return handleDeleteCanvasEntry(params);
  });

  const handleClearCanvas = useCallback(() => {
    setCanvasEntries([]);
    const activeId = sessionIdRef.current;
    if (activeId) {
      try {
        localStorage.removeItem(canvasBackupKey(activeId));
      } catch {}
      void fetch(`/api/sessions/${encodeURIComponent(activeId)}/canvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas_json: JSON.stringify([]) }),
      }).catch(() => {});
    }
    showToast("Canvas notes cleared.");
  }, []);

  // Hydrate resumed session transcripts and canvas entries
  useEffect(() => {
    if (!resumedSession) return;

    sessionIdRef.current = resumedSession.id;

    if (resumedSession.transcripts.length > 0) {
      setTranscript(
        resumedSession.transcripts.map((t) => ({
          source: t.role === "user" ? "user" : "ai",
          message: t.message,
        })),
      );
    }

    let initialCanvas = resumedSession.canvasEntries || [];

    if (initialCanvas.length === 0) {
      try {
        const localBackup = localStorage.getItem(canvasBackupKey(resumedSession.id));
        initialCanvas = parseCanvasJson(localBackup);
      } catch {}
    }

    setCanvasEntries(initialCanvas);
    showToast(`Loaded session "${resumedSession.title}". Ready to continue!`);
  }, [resumedSession]);

  const conv = useConversation({
    onConnect: ({ conversationId }: { conversationId: string }) => {
      if (!sessionIdRef.current) {
        sessionIdRef.current = conversationId || `sess_${Date.now()}`;
      }
      setPhase("live");

      const prior = resumedRef.current;
      if (prior && prior.transcripts.length > 0) {
        const verbatimText = prior.transcripts
          .map((t) => `${t.role === "user" ? "User" : "Agent"}: ${t.message}`)
          .join("\n");

        setTimeout(() => {
          conv.sendContextualUpdate(
            `[SYSTEM NOTE: This call is a direct continuation of a prior session titled "${prior.title}". Here is the verbatim transcript of all prior turns:\n\n${verbatimText}\n\nPlease seamlessly continue this conversation with the user where it left off.]`,
          );
          showToast(`Injected ${prior.transcripts.length} prior turns into Agent memory.`);
        }, 500);
      }
    },
    onMessage: (p: { message: string; source: string }) => {
      if (p.message) {
        setTranscript((t) => [...t, { source: p.source, message: p.message }]);
      }
    },
    onError: (msg: string) => {
      setErrorMsg(typeof msg === "string" ? msg : "Something went wrong.");
      setPhase("error");
    },
    onDisconnect: () => {
      setLevel(0);
      handleEnded();
    },
  });

  const { status, isSpeaking, endSession, isMuted, setMuted, sendUserMessage, sendContextualUpdate } = conv;
  const connected = status === "connected";

  // Live volume polling
  useEffect(() => {
    if (!connected) return;
    let raf = 0;
    const tick = () => {
      const v = isSpeaking ? conv.getOutputVolume() : conv.getInputVolume();
      setLevel((prev) => prev * 0.6 + v * 0.4);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, isSpeaking, conv]);

  // Session timer
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  // Auto scroll transcript
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [transcript]);

  const copyMessageText = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const finalize = useCallback(
    async (convId: string) => {
      setPhase("finishing");
      const turns = transcriptRef.current;
      const currentCanvas = canvasRef.current;
      const spoke = turns.filter((t) => t.source === "user").length;

      if (spoke === 0 && currentCanvas.length === 0) {
        setPhase("idle");
        return;
      }

      try {
        const firstMsg = turns.find((t) => t.source === "user")?.message || "Voice Conversation";
        const title = firstMsg.length > 35 ? firstMsg.substring(0, 35) + "..." : firstMsg;

        await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: convId,
            title,
            agent_id: agentId,
            status: "completed",
            duration_seconds: elapsed,
            canvas_entries: currentCanvas,
            canvas_json: JSON.stringify(currentCanvas),
            transcripts: turns.map((t) => ({
              role: t.source === "user" ? "user" : "agent",
              message: t.message,
              timestamp: new Date().toISOString(),
            })),
          }),
        });

        onSessionSaved?.(convId);
        showToast("Session saved to SQLite.");
        setPhase("idle");
      } catch (e) {
        console.error("Error saving session:", e);
        setPhase("idle");
      }
    },
    [agentId, elapsed, onSessionSaved],
  );

  const handleEnded = useCallback(() => {
    if (finalizedRef.current) return;
    const id = sessionIdRef.current;
    if (!id) {
      setPhase((p) => (p === "finishing" ? p : "idle"));
      return;
    }
    finalizedRef.current = true;
    void finalize(id);
  }, [finalize]);

  async function startSession() {
    if (!agentId) {
      openSettings();
      return;
    }

    setErrorMsg(null);
    if (!resumedRef.current) {
      setTranscript([]);
      setCanvasEntries([]);
      sessionIdRef.current = `sess_${Date.now()}`;
    }
    setElapsed(0);
    finalizedRef.current = false;
    setPhase("connecting");

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      let signedUrl = "";
      try {
        const urlRes = await fetch(`/api/voice/signed-url?agent_id=${encodeURIComponent(agentId)}`, {
          headers: apiKey ? { "x-api-key": apiKey } : {},
        });
        if (urlRes.ok) {
          const urlData = await urlRes.json();
          if (urlData.signedUrl) signedUrl = urlData.signedUrl;
        }
      } catch {
        console.warn("Could not fetch signed URL, using direct agent ID...");
      }

      if (signedUrl) {
        conv.startSession({ signedUrl });
      } else {
        conv.startSession({ agentId });
      }
    } catch (error: any) {
      setErrorMsg(error.message || "Failed to start session. Check mic permissions.");
      setPhase("error");
    }
  }

  function stopSession() {
    try {
      endSession();
    } catch {}
  }

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed || !connected) return;

    if (sendUserMessage) {
      sendUserMessage(trimmed);
      setTranscript((prev) => [...prev, { source: "user", message: trimmed }]);
    } else {
      setTranscript((prev) => [...prev, { source: "user", message: trimmed }]);
    }

    setTextInput("");
    setIsExpandedText(false);
  };

  const handleInjectContext = () => {
    const trimmed = textInput.trim();
    if (!trimmed || !connected) return;

    if (sendContextualUpdate) {
      sendContextualUpdate(trimmed);
      showToast(`Injected ${trimmed.split(/\s+/).filter(Boolean).length} words of background context to Agent.`);
    } else {
      showToast("Contextual update sent.");
    }

    setTextInput("");
    setIsExpandedText(false);
  };

  const speakerState: SpeakerState =
    phase === "connecting"
      ? "connecting"
      : connected
      ? isSpeaking
        ? "speaking"
        : "listening"
      : "idle";


  // ── Finishing phase ──
  if (phase === "finishing") {
    return (
      <div className="surface-card rounded-3xl p-16 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto my-12 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sky-400">
          <Loader2 className="w-7 h-7 animate-spin" />
        </div>
        <h3 className="text-sm font-bold text-zinc-100 tracking-tight">Finishing & Saving Session...</h3>
        <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
          Persisting transcripts and interactive canvas entries to SQLite.
        </p>
      </div>
    );
  }

  // ── Main 2-column Desktop Layout ──
  return (
    <div className="w-full max-w-full h-full min-h-0 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)] grid-cols-1 items-stretch min-w-0">
      {/* LEFT COLUMN: Voice Controller & Live Transcript Stream */}
      <section className="surface-card rounded-3xl p-4 flex flex-col min-h-0 h-full relative min-w-0 w-full overflow-hidden shadow-2xl">
        {toastMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-zinc-800/90 border border-zinc-700/80 text-zinc-200 text-xs font-medium shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Top Voice Assistant Control Dock */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/50 border border-zinc-800/60 flex flex-col items-center justify-center flex-shrink-0 relative overflow-hidden">
          <div className="w-full flex items-center justify-between text-[11px] font-medium text-zinc-400 mb-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected
                    ? "bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50"
                    : phase === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-zinc-600"
                }`}
              />
              <span className="text-zinc-300 font-semibold">
                {connected
                  ? isSpeaking
                    ? "Agent Speaking..."
                    : "Agent Listening"
                  : phase === "connecting"
                  ? "Connecting..."
                  : "Voice Agent Ready"}
              </span>
            </div>

            {connected && (
              <span className="font-mono text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/60 text-[10px]">
                {formatTimer(elapsed)}
              </span>
            )}
          </div>

          <AvatarSpeaker state={speakerState} level={level} />

          <div className="w-full max-w-[180px] mt-1 mb-2">
            <Waveform level={level} active={connected} />
          </div>

          {/* Action Call Controller */}
          <div className="w-full flex items-center justify-center gap-2 mt-1">
            {!connected ? (
              <button
                onClick={startSession}
                disabled={phase === "connecting"}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition-all shadow-md hover:shadow-lg active:scale-98 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {phase === "connecting" ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting Call...</span>
                  </>
                ) : phase === "error" ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Call</span>
                  </>
                ) : (
                  <>
                    <PhoneCall className="w-3.5 h-3.5 fill-zinc-950" />
                    <span>Start Voice Session</span>
                  </>
                )}
              </button>
            ) : (
              <div className="w-full flex items-center gap-2">
                <button
                  onClick={() => setMuted(!isMuted)}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    isMuted
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      : "bg-zinc-800/80 border-zinc-700/80 text-zinc-200 hover:bg-zinc-700"
                  }`}
                  title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span>{isMuted ? "Unmute" : "Mute"}</span>
                </button>

                <button
                  onClick={stopSession}
                  className="flex-1 py-2 px-3 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-medium text-xs shadow-md transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>End Call</span>
                </button>
              </div>
            )}
          </div>

          {errorMsg && (
            <p className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-lg w-full text-center">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Bottom Transcript Stream */}
        <div className="mt-3 flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden">
          <div className="pb-2 border-b border-zinc-800/80 flex items-center justify-between gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Live Transcript
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                ({transcript.length})
              </span>
            </div>

            <button
              onClick={() => setIsExpandedText(!isExpandedText)}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            >
              {isExpandedText ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              <span>{isExpandedText ? "Collapse" : "Paste Doc"}</span>
            </button>
          </div>

          {/* Messages Container */}
          <div
            ref={chatScrollRef}
            className="flex-1 min-h-0 overflow-y-auto py-3 space-y-3 pr-1.5 scroll-smooth"
          >
            {transcript.length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center text-zinc-500 text-xs p-4 space-y-1.5">
                <Sparkles className="w-4 h-4 text-zinc-600" />
                <p className="font-medium text-zinc-400">Conversation stream is ready</p>
                <p className="text-[11px] text-zinc-500 max-w-xs">
                  Spoken dialogue will transcribe here automatically.
                </p>
              </div>
            ) : (
              transcript.map((msg, index) => {
                const isUser = msg.source === "user";
                const isCopied = copiedIndex === index;

                return (
                  <div
                    key={index}
                    className={`group relative flex gap-2 text-xs ${
                      isUser ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {/* Role Avatar */}
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-semibold ${
                        isUser
                          ? "bg-indigo-500/20 border border-indigo-500/30 text-indigo-300"
                          : "bg-zinc-800 border border-zinc-700 text-zinc-300"
                      }`}
                    >
                      {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                    </div>

                    {/* Message Bubble */}
                    <div className="relative max-w-[84%]">
                      <div
                        className={`rounded-2xl px-3.5 py-2 whitespace-pre-wrap leading-relaxed shadow-sm ${
                          isUser
                            ? "bg-indigo-600/25 border border-indigo-500/30 text-zinc-100"
                            : "bg-[#18181f] border border-zinc-800 text-zinc-200"
                        }`}
                      >
                        <p className="text-xs">{msg.message}</p>
                      </div>

                      <button
                        onClick={() => copyMessageText(index, msg.message)}
                        className={`absolute top-1.5 ${
                          isUser ? "-left-6" : "-right-6"
                        } p-1 rounded text-zinc-500 hover:text-zinc-200 transition opacity-0 group-hover:opacity-100 cursor-pointer`}
                        title="Copy text"
                      >
                        {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Chat Input Form */}
          <form onSubmit={handleSendText} className="pt-2 border-t border-zinc-800/80 flex flex-col gap-2 flex-shrink-0">
            {isExpandedText ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3 h-3 text-sky-400" />
                    Paste Large Document Context ({textInput.split(/\s+/).filter(Boolean).length} words)
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">1000+ words</span>
                </div>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={!connected}
                  rows={4}
                  placeholder={
                    connected
                      ? "Paste article, prompt, resume, or document context..."
                      : "Connect call to paste document..."
                  }
                  className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition disabled:opacity-50 resize-y font-sans"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleInjectContext}
                    disabled={!connected || !textInput.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition disabled:opacity-40 cursor-pointer"
                    title="Inject silently into agent memory"
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>Inject Context</span>
                  </button>

                  <button
                    type="submit"
                    disabled={!connected || !textInput.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition disabled:opacity-40 cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    <span>Send</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={!connected}
                  placeholder={
                    connected
                      ? "Type a message to agent..."
                      : "Connect call to send text..."
                  }
                  className="flex-1 px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!connected || !textInput.trim()}
                  className="p-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold transition disabled:opacity-30 cursor-pointer shadow-sm"
                  title="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </form>
        </div>
      </section>

      {/* RIGHT COLUMN: Interactive Canvas Panel */}
      <section className="h-full min-h-0 flex flex-col min-w-0 w-full">
        <CanvasPanel
          entries={canvasEntries}
          onClear={handleClearCanvas}
          onUpdateEntry={(id, newMarkdown) => handleUpdateCanvasEntry({ id, markdown: newMarkdown })}
          onDeleteEntry={(id) => handleDeleteCanvasEntry(id)}
        />
      </section>
    </div>
  );
}

/** Public export — wraps inner component in the required ConversationProvider */
export default function VoiceChat(props: VoiceChatProps) {
  return (
    <ConversationProvider>
      <VoiceChatInner {...props} />
    </ConversationProvider>
  );
}
