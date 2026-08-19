import React, { useState, useEffect } from "react";
import {
  History,
  MessageSquare,
  Trash2,
  Clock,
  ChevronRight,
  RefreshCw,
  X,
  User,
  Bot,
  PlayCircle,
  FileText,
  Search,
} from "lucide-react";
export interface SessionItem {
  id: string;
  title: string;
  agent_id?: string;
  status: string;
  duration_seconds: number;
  canvas_json?: string;
  created_at: string;
  message_count?: number;
}

export interface TranscriptItem {
  id: string;
  role: "user" | "agent" | "system";
  message: string;
  timestamp: string;
}

interface SessionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId?: string;
  onResumeSession?: (
    session: SessionItem,
    transcripts: TranscriptItem[],
    canvasEntries: CanvasEntry[],
  ) => void;
}

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

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  isOpen,
  onClose,
  currentSessionId,
  onResumeSession,
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<{
    session: SessionItem;
    transcripts: TranscriptItem[];
    canvasEntries: CanvasEntry[];
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("Error fetching sessions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const viewSessionDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          const canvas = parseCanvasEntries(data.session.canvas_json);

          setSelectedSessionDetail({
            session: data.session,
            transcripts: data.session.transcripts || [],
            canvasEntries: canvas,
          });
        }
      }
    } catch (err) {
      console.error("Error fetching session details:", err);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this session?")) return;

    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (selectedSessionDetail?.session.id === id) {
          setSelectedSessionDetail(null);
        }
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  };

  const handleResume = (
    session: SessionItem,
    transcripts: TranscriptItem[],
    canvasEntries: CanvasEntry[] = [],
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    onResumeSession?.(session, transcripts, canvasEntries);
    onClose();
  };

  const filteredSessions = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0e0e12]/95 backdrop-blur-2xl border-l border-white/[0.08] shadow-2xl flex flex-col transition-all duration-300 animate-in slide-in-from-right">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-zinc-200 font-semibold text-xs uppercase tracking-wider">
          <History className="w-4 h-4 text-sky-400" />
          <span>Session History</span>
          <span className="text-zinc-500 font-mono">({sessions.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchSessions}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {selectedSessionDetail ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex-1 pr-2 min-w-0">
              <button
                onClick={() => setSelectedSessionDetail(null)}
                className="text-xs text-sky-400 hover:underline mb-1 inline-block cursor-pointer font-medium"
              >
                &larr; Back to all sessions
              </button>
              <h3 className="font-semibold text-zinc-100 text-sm truncate">{selectedSessionDetail.session.title}</h3>
              <p className="text-xs text-zinc-400 flex items-center gap-2 mt-0.5 font-mono">
                <span>{new Date(selectedSessionDetail.session.created_at).toLocaleDateString()}</span>
                <span>• {formatDuration(selectedSessionDetail.session.duration_seconds)}</span>
              </p>
            </div>

            <button
              onClick={() =>
                handleResume(
                  selectedSessionDetail.session,
                  selectedSessionDetail.transcripts,
                  selectedSessionDetail.canvasEntries,
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition cursor-pointer flex-shrink-0 shadow-sm"
              title="Resume conversation"
            >
              <PlayCircle className="w-3.5 h-3.5 fill-zinc-950" />
              <span>Resume</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedSessionDetail.canvasEntries.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Saved Canvas Notes ({selectedSessionDetail.canvasEntries.length})</span>
                </div>
                <div className="space-y-1.5">
                  {selectedSessionDetail.canvasEntries.map((entry, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#09090b] border border-zinc-800/80 text-xs text-zinc-300 font-mono truncate">
                      {entry.markdown.substring(0, 90)}...
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Transcript ({selectedSessionDetail.transcripts.length})
              </h4>
              {selectedSessionDetail.transcripts.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-6">No messages recorded.</p>
              ) : (
                selectedSessionDetail.transcripts.map((t, idx) => (
                  <div
                    key={t.id || `tr-${idx}`}
                    className={`flex gap-2 text-xs ${
                      t.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] ${
                        t.role === "user"
                          ? "bg-indigo-500/20 text-indigo-300"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {t.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                    </div>
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-1.5 ${
                        t.role === "user"
                          ? "bg-indigo-600/20 border border-indigo-500/30 text-zinc-200"
                          : "bg-zinc-900 border border-zinc-800 text-zinc-300"
                      }`}
                    >
                      <p className="leading-relaxed">{t.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b border-zinc-800 flex-shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isLoading && sessions.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-xs">Loading sessions...</div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-xs">
                No past sessions recorded yet.
              </div>
            ) : (
              filteredSessions.map((session) => {
                const canvasCount = parseCanvasEntries(session.canvas_json).length;

                return (
                  <div
                    key={session.id}
                    onClick={() => viewSessionDetail(session.id)}
                    className={`group p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      currentSessionId === session.id
                        ? "bg-zinc-900/90 border-zinc-700 shadow-md"
                        : "bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900/80 hover:border-zinc-700"
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-xs font-semibold text-zinc-200 truncate group-hover:text-sky-400 transition-colors">
                        {session.title}
                      </h4>
                      <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-1">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          {formatDuration(session.duration_seconds)}
                        </span>
                        <span className="flex items-center gap-1 font-mono">
                          <MessageSquare className="w-3 h-3 text-zinc-500" />
                          {session.message_count || 0}
                        </span>
                        {canvasCount > 0 && (
                          <span className="flex items-center gap-1 text-sky-400 font-mono text-[10px]">
                            <FileText className="w-3 h-3" />
                            {canvasCount} notes
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                        {new Date(session.created_at).toLocaleDateString()} {new Date(session.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const res = await fetch(`/api/sessions/${session.id}`);
                          if (res.ok) {
                            const data = await res.json();
                            const canvas = parseCanvasEntries(data.session?.canvas_json);
                            handleResume(session, data.session?.transcripts || [], canvas);
                          }
                        }}
                        className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition cursor-pointer"
                        title="Resume call"
                      >
                        <PlayCircle className="w-3.5 h-3.5 text-sky-400" />
                      </button>

                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="p-2 rounded-xl text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
