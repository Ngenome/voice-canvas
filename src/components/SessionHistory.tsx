import React, { useState, useEffect, useMemo } from "react";
import { X, Search, Trash2, ArrowLeft, BookOpen, MessagesSquare, NotebookPen, Clock, Loader2 } from "lucide-react";
import type { CanvasEntry } from "./CanvasPanel";
import { parseShelf, shelfGroups, versionOfDoc, type Shelf } from "../lib/documents";

export interface SessionItem {
  id: string;
  title: string;
  agent_id?: string;
  status: string;
  duration_seconds: number;
  canvas_json?: string;
  document_title?: string | null;
  document_count?: number;
  created_at: string;
  updated_at?: string;
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
  isLive?: boolean;
  onOpenSession?: (session: SessionItem, transcripts: TranscriptItem[], canvasEntries: CanvasEntry[], shelf: Shelf) => void;
}

type Detail = {
  session: SessionItem;
  transcripts: TranscriptItem[];
  canvasEntries: CanvasEntry[];
  shelf: Shelf;
};

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

/** SQLite CURRENT_TIMESTAMP is UTC without a zone marker. */
function parseDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
}

function groupLabel(date: Date): string {
  const today = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(date)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function formatDuration(secs: number) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  return m > 0 ? `${m} min` : `${secs}s`;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({ isOpen, onClose, currentSessionId, isLive, onOpenSession }) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
      void fetchSessions();
      setDetail(null);
      setConfirmDelete(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const loadDetail = async (id: string): Promise<Detail | null> => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.session) return null;
      return {
        session: data.session,
        transcripts: data.session.transcripts || [],
        canvasEntries: parseCanvasEntries(data.session.canvas_json),
        shelf: parseShelf(data.session.document_json),
      };
    } catch {
      return null;
    }
  };

  const open = (d: Detail) => {
    onOpenSession?.(d.session, d.transcripts, d.canvasEntries, d.shelf);
    onClose();
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (detail?.session.id === id) setDetail(null);
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    } finally {
      setConfirmDelete(null);
    }
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = sessions.filter(
      (s) => !q || s.title.toLowerCase().includes(q) || (s.document_title || "").toLowerCase().includes(q),
    );
    const map = new Map<string, SessionItem[]>();
    for (const s of filtered) {
      const label = groupLabel(parseDate(s.created_at));
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(s);
    }
    return [...map.entries()];
  }, [sessions, query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 fade-in" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-surface border-l border-line shadow-2xl flex flex-col slide-in">
        <header className="flex items-center gap-3 px-6 h-16 border-b border-line flex-shrink-0">
          {detail ? (
            <button className="btn btn-icon -ml-2" onClick={() => setDetail(null)} title="Back to library">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : null}
          <h2 className="font-serif text-xl font-medium flex-1 truncate">{detail ? detail.session.title : "Library"}</h2>
          <button className="btn btn-icon" onClick={onClose} title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </header>

        {detail ? (
          <DetailView detail={detail} isLive={!!isLive} onOpen={() => open(detail)} />
        ) : (
          <>
            <div className="px-6 py-4 flex-shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your library..."
                  className="field pl-9"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-8">
              {isLoading && sessions.length === 0 ? (
                <div className="py-20 flex justify-center text-faint">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : groups.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="font-serif text-lg">{query ? "Nothing matches that" : "Your library is empty"}</p>
                  <p className="text-sm text-faint mt-1">{query ? "Try a different word." : "Documents you read and conversations you have are saved here."}</p>
                </div>
              ) : (
                groups.map(([label, items]) => (
                  <section key={label} className="mb-6">
                    <h3 className="eyebrow mb-2">{label}</h3>
                    <div className="space-y-1">
                      {items.map((s) => {
                        const notes = parseCanvasEntries(s.canvas_json).length;
                        const isCurrent = s.id === currentSessionId;
                        const date = parseDate(s.created_at);
                        return (
                          <div
                            key={s.id}
                            role="button"
                            tabIndex={0}
                            onClick={async () => {
                              const d = await loadDetail(s.id);
                              if (d) setDetail(d);
                            }}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter") {
                                const d = await loadDetail(s.id);
                                if (d) setDetail(d);
                              }
                            }}
                            className={`group flex items-center gap-4 rounded-xl px-3 py-3 -mx-3 cursor-pointer transition-colors hover:bg-raised ${isCurrent ? "bg-raised" : ""}`}
                          >
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                s.document_title ? "bg-accent-soft text-accent" : "bg-sunken text-muted"
                              }`}
                            >
                              {s.document_title ? <BookOpen className="w-4 h-4" /> : <MessagesSquare className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">
                                {s.title}
                                {isCurrent && <span className="ml-2 text-xs text-accent font-normal">open now</span>}
                              </div>
                              <div className="text-xs text-faint mt-0.5 flex items-center gap-3 flex-wrap">
                                <span>{date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                                {formatDuration(s.duration_seconds) && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDuration(s.duration_seconds)}
                                  </span>
                                )}
                                {!!s.message_count && <span>{s.message_count} {s.message_count === 1 ? "message" : "messages"}</span>}
                                {notes > 0 && <span>{notes} {notes === 1 ? "note" : "notes"}</span>}
                                {(s.document_count ?? 0) > 1 && <span>{s.document_count} documents</span>}
                              </div>
                            </div>
                            {confirmDelete === s.id ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button className="btn btn-danger h-8 text-xs" onClick={() => void remove(s.id)}>
                                  Delete
                                </button>
                                <button className="btn h-8 text-xs" onClick={() => setConfirmDelete(null)}>
                                  Keep
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-icon h-8 w-8 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:!text-danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDelete(s.id);
                                }}
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function DetailView({ detail, isLive, onOpen }: { detail: Detail; isLive: boolean; onOpen: () => void }) {
  const { session, transcripts, canvasEntries, shelf } = detail;
  const groups = shelfGroups(shelf.documents);
  const document = shelf.documents.find((d) => d.id === shelf.activeId) ?? shelf.documents[0] ?? null;
  const date = parseDate(session.created_at);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
        <p className="text-sm text-faint">
          {date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} at {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {formatDuration(session.duration_seconds) ? ` · ${formatDuration(session.duration_seconds)}` : ""}
        </p>

        {groups.length > 0 && (
          <div className="space-y-2">
            {groups.map((versions) => {
              const d = versions[versions.length - 1];
              const progress = d.paragraphs.length > 0 ? Math.round(((d.position + 1) / d.paragraphs.length) * 100) : 0;
              const page = d.paragraphs[Math.max(d.position, 0)]?.page;
              return (
                <div key={d.groupId ?? d.id} className="panel rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-lg font-medium truncate">
                      {d.title}
                      {versions.length > 1 && <span className="ml-2 text-xs font-sans text-accent">v{versionOfDoc(d)} of {versions.length}</span>}
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-sunken overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="text-xs text-faint mt-1.5">
                      {d.position < 0 ? "Not started" : `${progress}% through${page ? ` · page ${page}` : ""}`}
                      {d.highlights?.length ? ` · ${d.highlights.length} highlight${d.highlights.length === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canvasEntries.length > 0 && (
          <section>
            <h3 className="eyebrow mb-2 flex items-center gap-1.5">
              <NotebookPen className="w-3.5 h-3.5" /> Notes
            </h3>
            <div className="space-y-2">
              {canvasEntries.map((e) => (
                <div key={e.id} className="rounded-xl border border-line px-4 py-3 text-sm text-muted line-clamp-4 whitespace-pre-wrap">
                  {e.markdown}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="eyebrow mb-3 flex items-center gap-1.5">
            <MessagesSquare className="w-3.5 h-3.5" /> Conversation
          </h3>
          {transcripts.length === 0 ? (
            <p className="text-sm text-faint">No conversation recorded.</p>
          ) : (
            <div className="space-y-4">
              {transcripts.map((t, i) => (
                <div key={t.id || i} className={`flex flex-col ${t.role === "user" ? "items-end" : "items-start"}`}>
                  <span className="eyebrow mb-1">{t.role === "user" ? "You" : "Agent"}</span>
                  <p
                    className={`max-w-[90%] leading-relaxed text-[0.93rem] whitespace-pre-wrap ${
                      t.role === "user" ? "bg-raised border border-line rounded-2xl rounded-tr-md px-3.5 py-2" : ""
                    }`}
                  >
                    {t.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="px-6 py-4 border-t border-line flex items-center justify-between gap-3 flex-shrink-0">
        <span className="text-xs text-faint">{isLive ? "End your current call to switch sessions." : ""}</span>
        <button className="btn btn-primary" onClick={onOpen} disabled={isLive}>
          {document ? <BookOpen className="w-4 h-4" /> : <MessagesSquare className="w-4 h-4" />}
          {document ? (document.position >= 0 ? "Continue reading" : "Open") : "Continue conversation"}
        </button>
      </footer>
    </div>
  );
}
