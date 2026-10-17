import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Pause,
  Play,
  Send,
  RotateCcw,
  BookOpen,
  NotebookPen,
  MessagesSquare,
  Copy,
  Check,
  Search,
  PanelRightClose,
  PanelRightOpen,
  Maximize,
  Minimize,
  Captions as CaptionsIcon,
  Loader2,
  WifiOff,
  X,
} from "lucide-react";
import { Orb, type OrbState } from "./Orb";
import { CanvasPanel, type CanvasEntry } from "./CanvasPanel";
import { ReaderPanel, type ParagraphAction } from "./ReaderPanel";
import type { SelectionAction } from "./SelectionToolbar";
import { webSearch, readWebpage } from "../lib/exa";
import {
  pageToBlob,
  scanFigurePages,
  serializeShelf,
  makeNewVersion,
  diffVersions,
  shelfGroups,
  versionsOf,
  groupOf,
  versionOfDoc,
  type ReadingDocument,
  type Shelf,
  type Highlight,
} from "../lib/documents";
import { CaptionEngine } from "../lib/captions";
import { playCue } from "../lib/sounds";
import { Captions } from "./Captions";
import { VoicePicker } from "./VoicePicker";
import { ModelPicker } from "./ModelPicker";
import { DocSwitcher } from "./DocSwitcher";

export interface ResumedSessionData {
  id: string;
  title: string;
  transcripts: { role: string; message: string }[];
  canvasEntries?: CanvasEntry[];
  shelf?: Shelf | null;
  summary?: ConversationSummary | null;
}

/** Summary of the older part of a long conversation; `covered` = number of turns it includes. */
export interface ConversationSummary {
  text: string;
  covered: number;
}

interface VoiceChatProps {
  agentId: string;
  apiKey: string;
  resumedSession?: ResumedSessionData | null;
  onSessionSaved?: (sessionId: string) => void;
  onLiveChange?: (live: boolean) => void;
  onTitleChange?: (title: string | null) => void;
  openSettings: () => void;
  /** App-level buttons (library, theme, settings) shown at the right of the top bar. */
  appActions?: React.ReactNode;
}

type Turn = { source: string; message: string };
type Phase = "idle" | "connecting" | "live" | "finishing" | "error";
type Tab = "reader" | "notes" | "chat";
type CanvasToolParams = {
  markdown?: string;
  content?: string;
  text?: string;
  source?: "agent" | "user" | "tool" | "system";
  toolName?: string;
};

/** Must match max_duration_seconds on the agent. */
const MAX_CALL_SECONDS = 7200;
/** How much transcript to send verbatim when a call (re)starts; older turns get summarized. */
const CONTEXT_VERBATIM_CHARS = 9000;
const CONTEXT_RECENT_CHARS = 5000;

function formatTimer(secs: number) {
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${mins}:${s.toString().padStart(2, "0")}`;
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

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
}

/** The dock orb polls audio levels itself so the rest of the UI doesn't re-render every frame. */
const LiveOrb = memo(function LiveOrb({ state, getLevel, size = 38 }: { state: OrbState; getLevel: (() => number) | null; size?: number }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!getLevel) {
      setLevel(0);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      // ~30fps is plenty for a glow.
      if (t - last > 33) {
        last = t;
        const v = getLevel();
        setLevel((prev) => prev * 0.6 + v * 0.4);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);
  return <Orb state={state} level={level} size={size} />;
});

/** Inner component — must live inside ConversationProvider */
function VoiceChatInner({ agentId, apiKey, resumedSession, onSessionSaved, onLiveChange, onTitleChange, openSettings, appActions }: VoiceChatProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [canvasEntries, setCanvasEntries] = useState<CanvasEntry[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  // The shelf holds every document (and version) in this session; `doc` is the one open now.
  const [doc, setDoc] = useState<ReadingDocument | null>(null);
  const [shelfDocs, setShelfDocs] = useState<ReadingDocument[]>([]);
  const [readRange, setReadRange] = useState<[number, number] | null>(null);
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState<Tab>("reader");
  const [adding, setAdding] = useState<null | { kind: "new" } | { kind: "version"; baseId: string; title: string }>(null);
  /** Trying to get a dropped call back. */
  const [reconnecting, setReconnecting] = useState(false);
  /** The call dropped and couldn't be restored automatically. */
  const [dropped, setDropped] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const droppedRef = useRef(false);
  droppedRef.current = dropped;
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem("vc_rail_collapsed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("vc_rail_collapsed", railCollapsed ? "1" : "0");
    } catch {}
  }, [railCollapsed]);

  // ── Captions ──
  const captionEngine = useState(() => new CaptionEngine())[0];
  // Dev-only handle for testing captions without a live call.
  if (import.meta.env.DEV) (window as unknown as { __captions?: CaptionEngine }).__captions = captionEngine;
  const [captionsOn, setCaptionsOn] = useState(() => {
    try {
      return localStorage.getItem("vc_captions") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("vc_captions", captionsOn ? "1" : "0");
    } catch {}
  }, [captionsOn]);
  const [isLarge, setIsLarge] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsLarge(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // ── Voice & speed (saved on the local server) ──
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [llm, setLlm] = useState<string | null>(null);
  const voicePrefsRef = useRef({ voiceId, voiceSpeed, llm });
  voicePrefsRef.current = { voiceId, voiceSpeed, llm };
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings?.voice_id) setVoiceId(d.settings.voice_id);
        const sp = Number(d.settings?.voice_speed);
        if (sp >= 0.7 && sp <= 1.2) setVoiceSpeed(sp);
        if (d.settings?.llm) setLlm(d.settings.llm);
      })
      .catch(() => {});
  }, []);
  const saveVoicePrefs = (id: string | null, speed: number) => {
    setVoiceId(id);
    setVoiceSpeed(speed);
    void fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: id ?? "", voice_speed: String(speed) }),
    }).catch(() => {});
  };

  const saveModel = (id: string | null) => {
    setLlm(id);
    void fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: id ?? "" }),
    }).catch(() => {});
  };

  // ── Immersive reading (full screen, chrome fades away) ──
  const [immersive, setImmersive] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const chromeHoverRef = useRef(false);
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;

  const toggleImmersive = useCallback(() => {
    if (!immersiveRef.current) {
      setImmersive(true);
      setChromeVisible(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      setImmersive(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    // Leaving browser full screen (Esc) also leaves immersive mode.
    const onFs = () => {
      if (!document.fullscreenElement && immersiveRef.current) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setCaptionsOn((v) => !v);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleImmersive();
      } else if (e.key === "Escape" && immersiveRef.current && !document.fullscreenElement) {
        setImmersive(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleImmersive]);

  useEffect(() => {
    if (!immersive) {
      setChromeVisible(true);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setChromeVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!chromeHoverRef.current) setChromeVisible(false);
        else wake();
      }, 2600);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    window.addEventListener("keydown", wake);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [immersive]);
  const [unseenNotes, setUnseenNotes] = useState(0);

  const canvasRef = useRef<CanvasEntry[]>(canvasEntries);
  canvasRef.current = canvasEntries;
  const docRef = useRef<ReadingDocument | null>(doc);
  docRef.current = doc;
  const readRangeRef = useRef(readRange);
  readRangeRef.current = readRange;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const sessionIdRef = useRef<string | null>(null);
  const finalizedRef = useRef(false);
  const transcriptRef = useRef<Turn[]>([]);
  transcriptRef.current = transcript;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const resumedRef = useRef(resumedSession);
  resumedRef.current = resumedSession;
  const pendingOnConnectRef = useRef<string | null>(null);
  const summaryRef = useRef<ConversationSummary | null>(null);
  const startSessionRef = useRef<(firstMessage?: string, isAutoReconnect?: boolean) => Promise<void>>(async () => {});
  const callStartRef = useRef(0);
  const sessionSecondsRef = useRef(0);
  const disconnectReasonRef = useRef<string>("");
  const autoReconnectRef = useRef(false);
  const autoReconnectsRef = useRef(0);
  const manualReconnectRef = useRef(false);
  /** Set when the user pauses: the call is ended on purpose and resumed later. */
  const pauseIntentRef = useRef(false);
  /** Set when the user hangs up, so a drop isn't mistaken for it. */
  const userEndedRef = useRef(false);
  /** Unexpected drops retried so far (reset once a call connects). */
  const dropRetriesRef = useRef(0);
  const reconnectNoteRef = useRef("");
  /** The document this session's library entry belongs to. */
  const shelfDocsRef = useRef<ReadingDocument[]>([]);
  const findFiguresRef = useRef<(docId: string, fileId: string) => Promise<void>>(async () => {});
  const pendingPageRef = useRef<{ page: number; text: string } | null>(null);
  const sendPageRef = useRef<(page: number, text: string, asUser: boolean) => Promise<void>>(async () => {});
  const sendPageToAgent = (page: number, text: string, asUser: boolean) => sendPageRef.current(page, text, asUser);
  /** The user's own reading place, reported by the reader as they scroll. */
  const viewRef = useRef<{ index?: number; page?: number }>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnnouncedPageRef = useRef<number | undefined>(undefined);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const ensureSessionId = () => {
    if (!sessionIdRef.current) sessionIdRef.current = `sess_${Date.now()}`;
    return sessionIdRef.current;
  };

  useEffect(() => {
    onTitleChange?.(doc?.title ?? null);
  }, [doc?.title, onTitleChange]);

  // ── Persistence ─────────────────────────────────────────
  // Saves go out one at a time, always with the newest list, so an older save can never
  // land after a newer one and bring deleted-or-missing notes back (or drop new ones).
  const canvasSaveRef = useRef<{ inFlight: boolean; next: { id: string; entries: CanvasEntry[] } | null }>({ inFlight: false, next: null });
  const flushCanvasSave = useCallback(async () => {
    const q = canvasSaveRef.current;
    if (q.inFlight || !q.next) return;
    const job = q.next;
    q.next = null;
    q.inFlight = true;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(job.id)}/canvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas_entries: job.entries, canvas_json: JSON.stringify(job.entries) }),
      });
    } catch {
      // Keep the latest list queued so it's retried with the next change.
      q.next ??= job;
    } finally {
      q.inFlight = false;
      if (q.next) void flushCanvasSave();
    }
  }, []);

  const persistCanvasEntries = useCallback(
    (entries: CanvasEntry[]) => {
      const activeId = ensureSessionId();
      try {
        localStorage.setItem(canvasBackupKey(activeId), JSON.stringify(entries));
      } catch {}
      canvasSaveRef.current.next = { id: activeId, entries };
      void flushCanvasSave();
    },
    [flushCanvasSave],
  );

  /** Saves the whole shelf (debounced). */
  const persistShelf = useCallback(() => {
    const sessionId = ensureSessionId();
    if (docSaveTimerRef.current) clearTimeout(docSaveTimerRef.current);
    docSaveTimerRef.current = setTimeout(() => {
      const docs = shelfDocsRef.current;
      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_json: serializeShelf({ activeId: docRef.current?.id ?? null, documents: docs }),
          title: docs[0]?.title ?? "",
        }),
      }).catch(() => {});
    }, 800);
  }, []);

  /** The one place the shelf changes: updates refs at once (so quick successive changes build on each other). */
  const commitShelf = useCallback(
    (docs: ReadingDocument[], activeId: string | null, save = true) => {
      shelfDocsRef.current = docs;
      setShelfDocs(docs);
      const active = docs.find((d) => d.id === activeId) ?? null;
      docRef.current = active;
      setDoc(active);
      if (save) persistShelf();
    },
    [persistShelf],
  );

  const updateDocById = useCallback(
    (id: string, fn: (d: ReadingDocument) => ReadingDocument) => {
      const docs = shelfDocsRef.current.map((d) => (d.id === id ? fn(d) : d));
      commitShelf(docs, docRef.current?.id ?? null);
    },
    [commitShelf],
  );

  const updateDoc = useCallback(
    (fn: (d: ReadingDocument) => ReadingDocument) => {
      const current = docRef.current;
      if (!current) return null;
      updateDocById(current.id, fn);
      return docRef.current;
    },
    [updateDocById],
  );

  const noteAdded = useCallback(() => {
    if (tabRef.current !== "notes") setUnseenNotes((n) => n + 1);
  }, []);

  // ── Canvas (notes) tools ────────────────────────────────
  // Notes change in one place: canvasRef is updated immediately, so back-to-back tool
  // calls (add, then edit) always build on the latest list instead of a stale copy.
  const commitCanvas = useCallback(
    (next: CanvasEntry[]) => {
      canvasRef.current = next;
      setCanvasEntries(next);
      persistCanvasEntries(next);
    },
    [persistCanvasEntries],
  );

  const noteHeading = (md: string) => md.split("\n")[0].replace(/^[#>\s*_-]+/, "").replace(/[*_`]/g, "").trim().toLowerCase();

  /** Finds exactly one note by id, or by its heading. Never matches several. */
  const findNote = (params: { id?: string; targetTitle?: string }): { entry?: CanvasEntry; error?: string } => {
    const list = canvasRef.current;
    if (params.id) {
      const entry = list.find((e) => e.id === params.id);
      return entry ? { entry } : { error: `No note with ID "${params.id}". Call list_canvas_entries to see IDs.` };
    }
    const title = (params.targetTitle || "").trim().toLowerCase();
    if (!title) return { error: "Give the note's ID (preferred) or its exact heading." };
    let matches = list.filter((e) => noteHeading(e.markdown) === title);
    if (matches.length === 0) matches = list.filter((e) => noteHeading(e.markdown).startsWith(title));
    if (matches.length === 1) return { entry: matches[0] };
    if (matches.length === 0) return { error: `No note has the heading "${params.targetTitle}". Call list_canvas_entries to see IDs.` };
    return { error: `${matches.length} notes match "${params.targetTitle}" (${matches.map((m) => m.id).join(", ")}). Use the ID to pick one.` };
  };

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
      commitCanvas([...canvasRef.current, newEntry]);
      noteAdded();
      showToast("Added a note");
      return `Note added (ID: ${newEntry.id}). Existing notes were kept.`;
    },
    [commitCanvas, showToast, noteAdded],
  );

  const handleListCanvasEntries = useCallback(() => {
    const current = canvasRef.current;
    if (current.length === 0) return "The canvas is currently empty (0 entries).";
    const items = current.map((entry, idx) => {
      const firstLine = entry.markdown.split("\n")[0].replace(/^[#\s*-_]+/, "").trim() || "Untitled Note";
      const snippet = entry.markdown.replace(/\n+/g, " ").substring(0, 70);
      return `[Index: ${idx + 1}] ID: "${entry.id}" | Title: "${firstLine}" | Preview: "${snippet}..."`;
    });
    return `CANVAS ENTRIES MANIFEST (${current.length} items):\n` + items.join("\n");
  }, []);

  const handleReadCanvas = useCallback((params?: { id?: string }) => {
    const current = canvasRef.current;
    if (current.length === 0) return "The canvas is currently empty.";
    if (params?.id) {
      const found = current.find((e) => e.id === params.id);
      if (found) return `[Card ID: ${found.id}]\n${found.markdown}`;
      return `Card with ID "${params.id}" was not found. Call list_canvas_entries to see available IDs.`;
    }
    const summary = current.map((entry, idx) => `[Card ${idx + 1} | ID: ${entry.id}]\n${entry.markdown}`).join("\n\n---\n\n");
    return `CURRENT CANVAS CONTENTS (${current.length} cards):\n\n${summary}`;
  }, []);

  const handleUpdateCanvasEntry = useCallback(
    (params: { id?: string; targetTitle?: string; markdown?: string; content?: string }) => {
      const newMarkdown = (params.markdown || params.content || "").trim();
      if (!newMarkdown) return "Error: No updated markdown provided.";
      const { entry, error } = findNote(params);
      if (!entry) return `Not updated. ${error}`;
      commitCanvas(
        canvasRef.current.map((e) =>
          e.id === entry.id ? { ...e, markdown: newMarkdown, createdAt: new Date().toISOString(), toolName: "update_canvas_entry" } : e,
        ),
      );
      showToast("Note updated");
      return `Note ${entry.id} updated. Other notes were kept.`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commitCanvas, showToast],
  );

  const handleDeleteCanvasEntry = useCallback(
    (params: { id?: string; targetTitle?: string } | string) => {
      const { entry, error } = findNote(typeof params === "string" ? { id: params } : params || {});
      if (!entry) return `Nothing deleted. ${error}`;
      commitCanvas(canvasRef.current.filter((e) => e.id !== entry.id));
      showToast("Note deleted");
      return `Note ${entry.id} deleted.`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commitCanvas, showToast],
  );

  useConversationClientTool("list_canvas_entries", () => handleListCanvasEntries());
  useConversationClientTool("read_canvas", (params: any) => handleReadCanvas(params));
  useConversationClientTool("append_to_canvas", (params: CanvasToolParams) => handleAppendCanvas(params));
  // Older agent configs may still call write_to_canvas: treat it as "add", never as "replace everything".
  useConversationClientTool("write_to_canvas", (params: CanvasToolParams) => handleAppendCanvas({ ...params, toolName: "write_to_canvas" }));
  useConversationClientTool("append_markdown", (params: CanvasToolParams) => handleAppendCanvas({ ...params, toolName: "append_markdown" }));
  useConversationClientTool("update_canvas_entry", (params: any) => handleUpdateCanvasEntry(params));
  useConversationClientTool("delete_canvas_entry", (params: any) => handleDeleteCanvasEntry(params));

  // ── Web tools (Exa, called from the browser) ────────────
  useConversationClientTool("web_search", async (params: { query?: string; objective?: string }) => {
    const query = (params?.query || "").trim();
    if (!query) return "Error: a search query is required.";
    showToast(`Searching: ${query}`);
    try {
      return await webSearch(query, params?.objective);
    } catch (err) {
      return `Web search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  useConversationClientTool("read_webpage", async (params: { url?: string; urls?: string[] }) => {
    const urls = (params?.urls?.length ? params.urls : params?.url ? [params.url] : []).filter(Boolean);
    if (urls.length === 0) return "Error: a URL is required.";
    showToast(`Reading ${urls[0]}`);
    try {
      return await readWebpage(urls);
    } catch (err) {
      return `Could not read the page: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  // ── Clock ───────────────────────────────────────────────
  const nowForAgent = () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const offset = `UTC${sign}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMin) % 60).padStart(2, "0")}`;
    const when = now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `It is ${when} for the user (${tz}, ${offset}).`;
  };

  // ── Reading companion tools ─────────────────────────────
  // The user reads; the agent listens, discusses, and can move the page when asked.
  const pageOfIndex = (d: ReadingDocument, idx: number) => d.paragraphs[Math.max(0, Math.min(idx, d.paragraphs.length - 1))]?.page;

  /** Where the user is looking right now (top of their screen). */
  const userView = () => {
    const d = docRef.current;
    if (!d) return { index: 0, page: undefined as number | undefined };
    const v = viewRef.current;
    const index = v.index ?? (v.page ? Math.max(0, d.paragraphs.findIndex((p) => (p.page ?? 0) >= v.page!)) : Math.max(d.position, 0));
    return { index, page: v.page ?? pageOfIndex(d, index) };
  };

  const describeDoc = (d: ReadingDocument) => {
    const { page } = userView();
    return [
      `Document: "${d.title}" (${d.source}${d.pageCount ? `, ${d.pageCount} pages` : ""}).`,
      page ? `The user is currently on page ${page}.` : "",
      d.figurePages?.length
        ? `Pages with figures or diagrams: ${d.figurePages.slice(0, 60).join(", ")}${d.figurePages.length > 60 ? ", ..." : ""}.`
        : "",
      d.fileId ? "You can see any page as an image with look_at_page." : "",
      versionsOf(shelfDocsRef.current, d).length > 1
        ? `This is version ${versionOfDoc(d)} of ${versionsOf(shelfDocsRef.current, d).length}; compare_versions shows what changed.`
        : "",
      shelfLine(d),
    ]
      .filter(Boolean)
      .join(" ");
  };

  /** "Also on the shelf: ..." for the agent. */
  const shelfLine = (active: ReadingDocument) => {
    const others = shelfGroups(shelfDocsRef.current)
      .map((vs) => vs[vs.length - 1])
      .filter((d) => groupOf(d) !== groupOf(active));
    return others.length ? `Also on the user's shelf: ${others.map((d) => `"${d.title}"`).join(", ")} (use switch_document to open one).` : "";
  };

  /** Finds a shelf document by title, id or "v2"-style version label. */
  const findShelfDoc = (ref?: string): ReadingDocument | undefined => {
    const docs = shelfDocsRef.current;
    if (!ref) return docRef.current ?? undefined;
    const r = ref.trim().toLowerCase();
    const byId = docs.find((d) => d.id.toLowerCase() === r);
    if (byId) return byId;
    const v = r.match(/^v(?:ersion)?\s*(\d+)$/);
    if (v && docRef.current) return versionsOf(docs, docRef.current).find((d) => versionOfDoc(d) === Number(v[1]));
    const latest = shelfGroups(docs).map((vs) => vs[vs.length - 1]);
    return latest.find((d) => d.title.toLowerCase() === r) ?? latest.find((d) => d.title.toLowerCase().includes(r));
  };

  /** Moves the user's view to a passage and highlights it briefly. */
  const pointTo = (idx: number) => {
    setTab("reader");
    setReadRange([idx, idx]);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setReadRange(null), 6000);
  };

  const passagesText = (d: ReadingDocument, from: number, maxChars: number) => {
    let out = "";
    for (let i = from; i < d.paragraphs.length && out.length < maxChars; i++) {
      const p = d.paragraphs[i];
      out += `${p.isHeading ? "## " : ""}${p.text}\n\n`;
    }
    return out.trim().slice(0, maxChars);
  };

  useConversationClientTool("get_document_info", () => {
    const d = docRef.current;
    if (!d) return "No document is open. Ask the user to open a PDF, paste text, or open a web page in the reader.";
    const outline = d.paragraphs
      .map((p) => (p.isHeading ? `- ${p.text}${p.page ? ` (page ${p.page})` : ""}` : null))
      .filter(Boolean)
      .slice(0, 80)
      .join("\n");
    return `${describeDoc(d)}${outline ? `\n\nOutline:\n${outline}` : ""}`;
  });

  useConversationClientTool("get_current_time", () => nowForAgent());

  useConversationClientTool("get_current_view", () => {
    const d = docRef.current;
    if (!d) return "No document is open.";
    const { index, page } = userView();
    return `The user is looking at ${page ? `page ${page}` : "this part of the document"}. Text on their screen, from the top:\n\n${passagesText(d, index, 3500)}`;
  });

  useConversationClientTool("get_page_text", (params: { page?: number }) => {
    const d = docRef.current;
    if (!d) return "No document is open.";
    const page = Number(params?.page) || userView().page;
    if (!page) return "This document has no page numbers. Use get_current_view instead.";
    const text = d.paragraphs
      .filter((p) => p.page === page)
      .map((p) => `${p.isHeading ? "## " : ""}${p.text}`)
      .join("\n\n");
    if (!text) return `Page ${page} has no extractable text${d.figurePages?.includes(page) ? "; it has a figure, so use look_at_page" : ""}.`;
    const marks = (d.highlights || []).filter((h) => h.page === page).map((h) => `- "${h.text}"`);
    return `Page ${page}:\n\n${text.slice(0, 7000)}${marks.length ? `\n\nThe user highlighted on this page:\n${marks.join("\n")}` : ""}`;
  });

  useConversationClientTool("search_document", (params: { query?: string; all_documents?: boolean }) => {
    const active = docRef.current;
    if (!active) return "No document is open.";
    const q = (params?.query || "").trim().toLowerCase();
    if (!q) return "Error: a search query is required.";
    const docs = params?.all_documents ? shelfGroups(shelfDocsRef.current).map((vs) => vs[vs.length - 1]) : [active];
    const hits: string[] = [];
    for (const d of docs) {
      for (let i = 0; i < d.paragraphs.length && hits.length < 12; i++) {
        const t = d.paragraphs[i].text;
        const at = t.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const snippet = t.slice(Math.max(0, at - 80), at + q.length + 120).replace(/\s+/g, " ");
        hits.push(`- ${docs.length > 1 ? `"${d.title}", ` : ""}page ${d.paragraphs[i].page ?? "?"}: "...${snippet}..."`);
      }
    }
    return hits.length ? `Matches for "${params.query}":\n${hits.join("\n")}` : `No matches for "${params.query}".`;
  });

  useConversationClientTool("list_documents", () => {
    const groups = shelfGroups(shelfDocsRef.current);
    if (!groups.length) return "The shelf is empty.";
    const activeId = docRef.current?.id;
    return groups
      .map((vs) => {
        const latest = vs[vs.length - 1];
        const open = vs.find((d) => d.id === activeId);
        const versions = vs.length > 1 ? ` · versions: ${vs.map((d) => `v${versionOfDoc(d)}`).join(", ")}` : "";
        return `- "${latest.title}"${latest.pageCount ? ` (${latest.pageCount} pages)` : ""}${versions}${open ? ` · OPEN (v${versionOfDoc(open)})` : ""}`;
      })
      .join("\n");
  });

  useConversationClientTool("switch_document", (params: { document?: string }) => {
    const target = findShelfDoc(params?.document);
    if (!target) return `No document matching "${params?.document}". Call list_documents to see the shelf.`;
    shelfOpsRef.current.switchDocument(target.id);
    return `Opened "${target.title}"${versionsOf(shelfDocsRef.current, target).length > 1 ? ` (v${versionOfDoc(target)})` : ""}.`;
  });

  useConversationClientTool("compare_versions", (params: { from?: string; to?: string }) => {
    const active = docRef.current;
    if (!active) return "No document is open.";
    const vs = versionsOf(shelfDocsRef.current, active);
    if (vs.length < 2) return "This document has only one version.";
    const pick = (ref: string | undefined, fallback: ReadingDocument) => {
      const n = Number((ref || "").replace(/\D/g, ""));
      return vs.find((d) => versionOfDoc(d) === n) ?? fallback;
    };
    const a = pick(params?.from, vs[vs.length - 2]);
    const b = pick(params?.to, vs[vs.length - 1]);
    const { added, removed } = diffVersions(a, b);
    const fmt = (ps: typeof added) =>
      ps
        .slice(0, 15)
        .map((p) => `- page ${p.page ?? "?"}: ${p.text.slice(0, 220)}${p.text.length > 220 ? "..." : ""}`)
        .join("\n");
    return [
      `Comparing v${versionOfDoc(a)} (${a.paragraphs.length} passages) with v${versionOfDoc(b)} (${b.paragraphs.length} passages).`,
      `${added.length} passages added, ${removed.length} removed or changed.`,
      added.length ? `Added in v${versionOfDoc(b)}:\n${fmt(added)}` : "",
      removed.length ? `Gone from v${versionOfDoc(a)}:\n${fmt(removed)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  useConversationClientTool("go_to", (params: { page?: number; search?: string }) => {
    const d = docRef.current;
    if (!d) return "No document is open.";
    let idx = -1;
    if (params?.page) {
      const target = Number(params.page);
      idx = d.paragraphs.findIndex((p) => (p.page ?? 0) >= target);
      if (idx < 0) return `Page ${target} is past the end (${d.pageCount ?? "?"} pages).`;
    } else if (params?.search) {
      const q = params.search.toLowerCase();
      idx = d.paragraphs.findIndex((p) => p.text.toLowerCase().includes(q));
      if (idx < 0) return `Couldn't find "${params.search}" in the document.`;
    } else return "Give a page number or some text to find.";
    pointTo(idx);
    const pg = pageOfIndex(d, idx);
    return `Moved the user's view to ${pg ? `page ${pg}` : "that spot"} and highlighted it.`;
  });

  useConversationClientTool("turn_page", (params: { direction?: string; count?: number }) => {
    const d = docRef.current;
    if (!d) return "No document is open.";
    const { page } = userView();
    if (!page) return "This document has no pages. Use go_to with some text instead.";
    const step = Math.max(1, Math.min(Number(params?.count) || 1, 50));
    const target = params?.direction === "previous" ? Math.max(1, page - step) : page + step;
    const idx = d.paragraphs.findIndex((p) => (p.page ?? 0) >= target);
    if (idx < 0) return `That's the end of the document (${d.pageCount ?? page} pages).`;
    pointTo(idx);
    return `Turned to page ${pageOfIndex(d, idx)}.`;
  });

  useConversationClientTool("look_at_page", (params: { page?: number; question?: string }) => {
    const d = docRef.current;
    if (!d) return "No document is open.";
    if (!d.fileId) return "The original PDF isn't stored for this document, so you can't see its pages. Ask the user to open Pages view and attach the PDF.";
    const page = Number(params?.page) || userView().page;
    if (!page || (d.pageCount && page > d.pageCount)) return `Page out of range (1-${d.pageCount ?? "?"}).`;
    // Send after the tool call returns so the image arrives as its own message.
    setTimeout(() => void sendPageToAgent(page, params?.question || `Here is page ${page} as printed.`, false), 250);
    return `An image of page ${page} is being sent and will arrive as the next message. Wait for it, then describe what you see.`;
  });

  // ── Hydrate resumed session ─────────────────────────────
  useEffect(() => {
    if (!resumedSession) return;
    sessionIdRef.current = resumedSession.id;
    summaryRef.current = resumedSession.summary ?? null;
    if (resumedSession.transcripts.length > 0) {
      setTranscript(resumedSession.transcripts.map((t) => ({ source: t.role === "user" ? "user" : "ai", message: t.message })));
    }
    let initialCanvas = resumedSession.canvasEntries || [];
    if (initialCanvas.length === 0) {
      try {
        initialCanvas = parseCanvasJson(localStorage.getItem(canvasBackupKey(resumedSession.id)));
      } catch {}
    }
    setCanvasEntries(initialCanvas);
    const shelf = resumedSession.shelf;
    if (shelf && shelf.documents.length) {
      commitShelf(shelf.documents, shelf.activeId, false);
      for (const d of shelf.documents) if (d.fileId && !d.figurePages) void findFiguresRef.current(d.id, d.fileId);
      setTab("reader");
    } else if (initialCanvas.length > 0) {
      setTab("notes");
    }
  }, [resumedSession]);

  // ── Conversation ────────────────────────────────────────
  const conv = useConversation({
    onConnect: ({ conversationId }: { conversationId: string }) => {
      if (!sessionIdRef.current) sessionIdRef.current = conversationId || `sess_${Date.now()}`;
      setPhase("live");

      callStartRef.current = Date.now();
      const wasRecovering = dropRetriesRef.current > 0;
      dropRetriesRef.current = 0;
      setReconnecting(false);
      setDropped(false);
      playCue(wasRecovering || transcriptRef.current.length ? "resume" : "connect");
      if (wasRecovering) showToast("Reconnected");
      setTimeout(async () => {
        const context = await buildContinuityContext();
        conv.sendContextualUpdate(`[${nowForAgent()}]`);
        if (context) conv.sendContextualUpdate(context);
        const d = docRef.current;
        if (d) conv.sendContextualUpdate(`[The user has a document open in the reader. ${describeDoc(d)}]`);
        const pendingPage = pendingPageRef.current;
        pendingPageRef.current = null;
        if (pendingPage) void sendPageRef.current(pendingPage.page, pendingPage.text, true);
        const pending = pendingOnConnectRef.current;
        pendingOnConnectRef.current = null;
        if (pending) {
          conv.sendUserMessage(pending);
          setTranscript((t) => [...t, { source: "user", message: pending }]);
        }
      }, 500);
    },
    onMessage: (p: { message: string; source: string }) => {
      if (p.message) setTranscript((t) => [...t, { source: p.source, message: p.message }]);
      if (p.message && p.source !== "user") captionEngine.onAgentText(p.message);
    },
    onAudioAlignment: (a: { chars: string[]; char_start_times_ms: number[]; char_durations_ms: number[] }) => captionEngine.onAlignment(a),
    onInterruption: () => captionEngine.interrupt(),
    onError: (msg: string) => {
      setErrorMsg(typeof msg === "string" ? msg : "Something went wrong.");
      setPhase("error");
    },
    onDisconnect: (details?: { reason?: string }) => {
      disconnectReasonRef.current = details?.reason || "";
      const callSecs = callStartRef.current ? (Date.now() - callStartRef.current) / 1000 : 0;
      const wasConnected = callStartRef.current > 0;
      sessionSecondsRef.current += Math.round(callSecs);
      const pausing = pauseIntentRef.current;
      const userEnded = userEndedRef.current;
      pauseIntentRef.current = false;
      userEndedRef.current = false;
      // The call hit the duration limit (not you hanging up): reconnect and carry on.
      autoReconnectRef.current =
        !pausing && details?.reason !== "user" && callSecs >= MAX_CALL_SECONDS - 60 && autoReconnectsRef.current < 6;
      // An unexpected drop (network, server): try to get it back, a few times, with growing waits.
      const isDrop = !pausing && !userEnded && details?.reason === "error" && !autoReconnectRef.current;
      if (isDrop) {
        if (dropRetriesRef.current < 3) {
          dropRetriesRef.current += 1;
          autoReconnectRef.current = true;
          reconnectNoteRef.current = "Connection lost. Reconnecting...";
          setReconnecting(true);
          if (dropRetriesRef.current === 1 && wasConnected) playCue("drop");
        } else {
          dropRetriesRef.current = 0;
          setReconnecting(false);
          setDropped(true);
          playCue("drop");
        }
      } else if (pausing) {
        playCue("pause");
      } else if (!autoReconnectRef.current && wasConnected) {
        playCue("end");
      }
      // Reconnect requested by the app itself (e.g. switching voice mid-call).
      if (manualReconnectRef.current) {
        manualReconnectRef.current = false;
        autoReconnectRef.current = true;
        reconnectNoteRef.current = reconnectNoteRef.current || "Switching...";
      }
      callStartRef.current = 0;
      if (!pausing) {
        pausedRef.current = false;
        setPaused(false);
      }
      captionEngine.reset();
      handleEnded();
    },
  });

  const { status, isSpeaking, endSession, isMuted, setMuted, sendUserMessage, sendContextualUpdate } = conv;
  const connected = status === "connected";

  useEffect(() => {
    onLiveChange?.(connected || phase === "connecting");
  }, [connected, phase, onLiveChange]);

  const convRef = useRef(conv);
  convRef.current = conv;

  sendPageRef.current = async (page: number, text: string, asUser: boolean) => {
    const d = docRef.current;
    if (!d?.fileId) {
      showToast("Attach the PDF in Pages view first");
      return;
    }
    try {
      showToast(`Showing page ${page} to the agent...`);
      const blob = await pageToBlob(d.fileId, page);
      const { fileId } = await convRef.current.uploadFile(new File([blob], `page-${page}.jpg`, { type: "image/jpeg" }));
      convRef.current.sendMultimodalMessage({ text, fileId });
      setTranscript((t) => [
        ...t,
        { source: asUser ? "user" : "system", message: asUser ? `${text} [page ${page} attached]` : `Page ${page} shown to the agent` },
      ]);
    } catch (e) {
      console.error("Sending page failed", e);
      showToast(`Couldn't send page ${page}: ${e instanceof Error ? e.message : "upload failed"}`);
    }
  };
  const getLevel = useCallback(() => {
    const c = convRef.current;
    try {
      return c.isSpeaking ? c.getOutputVolume() : c.getInputVolume();
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    if (!connected || paused) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [connected, paused]);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [transcript, tab]);

  const spokenTurns = (turns: Turn[]) => turns.filter((t) => t.source !== "system");
  const turnLine = (t: Turn) => `${t.source === "user" ? "User" : "Agent"}: ${t.message}`;

  /** Makes sure older turns are summarized when the conversation is too long to send in full. */
  const ensureSummary = async (all: Turn[]): Promise<{ summary: ConversationSummary | null; recentFrom: number }> => {
    const turns = spokenTurns(all);
    const totalChars = turns.reduce((n, t) => n + t.message.length + 8, 0);
    if (totalChars <= CONTEXT_VERBATIM_CHARS) return { summary: summaryRef.current, recentFrom: 0 };

    // Keep the most recent turns verbatim; everything before them belongs in the summary.
    let recentFrom = turns.length;
    let chars = 0;
    while (recentFrom > 0 && chars + turns[recentFrom - 1].message.length + 8 <= CONTEXT_RECENT_CHARS) {
      recentFrom -= 1;
      chars += turns[recentFrom].message.length + 8;
    }
    const prev = summaryRef.current;
    if (prev && prev.covered >= recentFrom) return { summary: prev, recentFrom: prev.covered };

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousSummary: prev?.text || "",
          turns: turns.slice(prev?.covered ?? 0, recentFrom).map((t) => ({ role: t.source === "user" ? "user" : "agent", message: t.message })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.summary) throw new Error(data.error || "no summary");
      const next = { text: data.summary as string, covered: recentFrom };
      summaryRef.current = next;
      const id = sessionIdRef.current;
      if (id) {
        void fetch(`/api/sessions/${encodeURIComponent(id)}/summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary_json: JSON.stringify(next) }),
        }).catch(() => {});
      }
      return { summary: next, recentFrom };
    } catch (e) {
      // No summarizer available: fall back to the old summary (if any) plus the recent turns.
      console.warn("Summary unavailable, sending recent turns only:", e);
      return { summary: prev, recentFrom: prev ? Math.max(prev.covered, recentFrom) : recentFrom };
    }
  };

  /** What the agent needs to continue seamlessly: summary of older turns + the recent ones verbatim. */
  const buildContinuityContext = async (): Promise<string> => {
    const turns = spokenTurns(transcriptRef.current);
    if (turns.length === 0) return "";
    const { summary, recentFrom } = await ensureSummary(transcriptRef.current);
    const recent = turns.slice(recentFrom).map(turnLine).join("\n");
    const omitted = recentFrom - (summary?.covered ?? 0);
    return [
      "[CONTEXT: This call continues an ongoing conversation with the same user. Do not greet them again or re-introduce yourself; pick up naturally where things left off.",
      summary ? `\nSummary of the earlier conversation:\n${summary.text}` : "",
      omitted > 0 ? `\n(${omitted} older messages are not shown.)` : "",
      `\nMost recent messages, verbatim:\n${recent}`,
      "]",
    ]
      .filter(Boolean)
      .join("\n");
  };

  const finalize = useCallback(
    async (convId: string) => {
      setPhase("finishing");
      const turns = transcriptRef.current;
      const currentCanvas = canvasRef.current;
      const currentDoc = docRef.current;
      const spoke = turns.filter((t) => t.source === "user").length;

      if (spoke === 0 && currentCanvas.length === 0 && !currentDoc) {
        setPhase("idle");
        return;
      }

      try {
        const firstMsg = turns.find((t) => t.source === "user")?.message || "Voice conversation";
        const title = currentDoc?.title || (firstMsg.length > 60 ? `${firstMsg.substring(0, 57)}...` : firstMsg);

        await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: convId,
            title,
            agent_id: agentId,
            status: "completed",
            duration_seconds: sessionSecondsRef.current || elapsed,
            canvas_entries: currentCanvas,
            canvas_json: JSON.stringify(currentCanvas),
            document_json: shelfDocsRef.current.length
              ? serializeShelf({ activeId: currentDoc?.id ?? null, documents: shelfDocsRef.current })
              : undefined,
            transcripts: turns.map((t) => ({
              role: t.source === "user" ? "user" : "agent",
              message: t.message,
              timestamp: new Date().toISOString(),
            })),
          }),
        });

        onSessionSaved?.(convId);
        if (!autoReconnectRef.current && !pausedRef.current) showToast("Saved to your library");
        // Summarize ahead of time so the next call starts quickly.
        void ensureSummary(transcriptRef.current);
      } catch (e) {
        console.error("Error saving session:", e);
        showToast("Couldn't save this session");
      } finally {
        setPhase("idle");
        if (autoReconnectRef.current) {
          autoReconnectRef.current = false;
          autoReconnectsRef.current += 1;
          showToast(reconnectNoteRef.current || "Call time limit reached. Reconnecting...");
          reconnectNoteRef.current = "";
          const wait = [600, 1000, 3000, 6000][dropRetriesRef.current] ?? 600;
          setTimeout(() => void startSessionRef.current(undefined, true), wait);
        }
      }
    },
    [agentId, elapsed, onSessionSaved, showToast],
  );

  // ── Save as you go ──
  // The conversation is written to the library a few seconds after each new message, so a
  // crash or dropped connection never loses more than the last moment.
  const liveSaveRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; inFlight: boolean; again: boolean }>({
    timer: null,
    inFlight: false,
    again: false,
  });
  const saveSnapshot = useCallback(async () => {
    const q = liveSaveRef.current;
    if (q.inFlight) {
      q.again = true;
      return;
    }
    const id = sessionIdRef.current;
    const turns = transcriptRef.current;
    if (!id || !turns.some((t) => t.source === "user")) return;
    q.inFlight = true;
    try {
      const currentDoc = docRef.current;
      const firstMsg = turns.find((t) => t.source === "user")?.message || "Voice conversation";
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: shelfDocsRef.current[0]?.title || currentDoc?.title || (firstMsg.length > 60 ? `${firstMsg.substring(0, 57)}...` : firstMsg),
          agent_id: agentId,
          status: "active",
          duration_seconds: sessionSecondsRef.current + (callStartRef.current ? Math.round((Date.now() - callStartRef.current) / 1000) : 0),
          transcripts: turns.map((t) => ({ role: t.source === "user" ? "user" : "agent", message: t.message })),
        }),
      });
    } catch {
      // The next message (or the end of the call) will try again.
    } finally {
      q.inFlight = false;
      if (q.again) {
        q.again = false;
        void saveSnapshot();
      }
    }
  }, [agentId]);

  useEffect(() => {
    if (!transcript.length) return;
    const q = liveSaveRef.current;
    if (q.timer) clearTimeout(q.timer);
    q.timer = setTimeout(() => void saveSnapshot(), 2500);
  }, [transcript, saveSnapshot]);

  useEffect(() => {
    const on = () => {
      setOffline(false);
      if (droppedRef.current) void startSessionRef.current(undefined, true);
    };
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

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

  async function startSession(firstMessage?: string, isAutoReconnect = false) {
    if (!agentId) {
      openSettings();
      return;
    }

    setErrorMsg(null);
    if (!isAutoReconnect) {
      autoReconnectsRef.current = 0;
      dropRetriesRef.current = 0;
      setDropped(false);
      setReconnecting(false);
    }
    // Keep the transcript: a new call in the same session continues the same conversation.
    const continuing = transcriptRef.current.some((t) => t.source !== "system");
    ensureSessionId();
    setElapsed(0);
    setPaused(false);
    finalizedRef.current = false;
    pendingOnConnectRef.current = firstMessage || null;
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

      // When continuing, skip the canned greeting so the agent picks up mid-conversation.
      const { voiceId: vId, voiceSpeed: vSpeed, llm: model } = voicePrefsRef.current;
      const tts = { ...(vId ? { voiceId: vId } : {}), ...(vSpeed !== 1 ? { speed: vSpeed } : {}) };
      const agentOverride = {
        ...(continuing ? { firstMessage: "" } : {}),
        ...(model ? { prompt: { llm: model } } : {}),
      };
      const overrides =
        Object.keys(agentOverride).length || Object.keys(tts).length
          ? { ...(Object.keys(agentOverride).length ? { agent: agentOverride } : {}), ...(Object.keys(tts).length ? { tts } : {}) }
          : undefined;
      if (signedUrl) conv.startSession({ signedUrl, overrides });
      else conv.startSession({ agentId, overrides });
    } catch (error: any) {
      setErrorMsg(error?.message || "Couldn't start. Check microphone permissions.");
      setPhase("error");
      setReconnecting(false);
    }
  }

  startSessionRef.current = startSession;

  function stopSession() {
    try {
      endSession();
    } catch {}
  }

  /** The End button: a deliberate hang-up (never treated as a drop). */
  const hangUp = () => {
    userEndedRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    setDropped(false);
    setReconnecting(false);
    stopSession();
  };

  /** Sends a message as the user, starting a call first if needed. */
  const say = (message: string) => {
    if (connected) {
      sendUserMessage(message);
      setTranscript((prev) => [...prev, { source: "user", message }]);
    } else if (phase !== "connecting") {
      void startSession(message);
    }
  };

  /**
   * Pause really pauses: the call ends cleanly (the agent can't keep talking into a muted line),
   * the conversation is saved, and Resume reconnects with full context and no greeting.
   */
  const togglePause = useCallback(() => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      void startSessionRef.current(undefined, true);
      return;
    }
    if (!connected) return;
    pausedRef.current = true;
    pauseIntentRef.current = true;
    setPaused(true);
    captionEngine.reset();
    try {
      conv.setVolume({ volume: 0 });
    } catch {}
    stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, conv, captionEngine]);

  // Keyboard: Space pauses/resumes, M toggles the mic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" && (connected || pausedRef.current)) {
        e.preventDefault();
        togglePause();
      } else if (e.key.toLowerCase() === "m" && connected && !pausedRef.current) {
        setMuted(!isMuted);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connected, togglePause, isMuted, setMuted]);

  // ── Document actions ────────────────────────────────────
  /** Adds a document to this session's shelf and opens it. */
  const openDocument = (next: ReadingDocument) => {
    viewRef.current = {};
    commitShelf([...shelfDocsRef.current, next], next.id);
    setReadRange(null);
    setTab("reader");
    onSessionSaved?.(ensureSessionId());
    if (next.fileId && !next.figurePages) void findFigures(next.id, next.fileId);
    if (connected) sendContextualUpdate(`[The user added a document to the shelf and opened it. ${describeDoc(next)}]`);
  };

  const switchDocument = (id: string) => {
    if (docRef.current?.id === id) return;
    const target = shelfDocsRef.current.find((d) => d.id === id);
    if (!target) return;
    viewRef.current = {};
    lastAnnouncedPageRef.current = undefined;
    commitShelf(shelfDocsRef.current, id);
    setReadRange(null);
    setTab("reader");
    if (connected) sendContextualUpdate(`[The user switched documents. ${describeDoc(target)}]`);
  };

  /** Removes a document (all its versions) from the shelf. */
  const removeDocument = (id: string) => {
    const target = shelfDocsRef.current.find((d) => d.id === id);
    if (!target) return;
    const group = groupOf(target);
    const docs = shelfDocsRef.current.filter((d) => groupOf(d) !== group);
    const stillActive = docs.some((d) => d.id === docRef.current?.id);
    const groups = shelfGroups(docs);
    const fallback = groups.length ? groups[groups.length - 1][groups[groups.length - 1].length - 1].id : null;
    viewRef.current = {};
    commitShelf(docs, stillActive ? docRef.current!.id : fallback);
    setReadRange(null);
    if (connected) sendContextualUpdate(`[The user removed "${target.title}" from the shelf.]`);
  };

  /** Adds `fresh` as the next version of document `baseId`, carrying place and highlights across. */
  const addVersion = (baseId: string, fresh: ReadingDocument) => {
    const base = shelfDocsRef.current.find((d) => d.id === baseId);
    if (!base) return openDocument(fresh);
    const { doc: next, moved, missing } = makeNewVersion(base, fresh, shelfDocsRef.current);
    viewRef.current = {};
    commitShelf([...shelfDocsRef.current, next], next.id);
    setReadRange(null);
    setTab("reader");
    if (next.fileId && !next.figurePages) void findFigures(next.id, next.fileId);
    const total = moved + missing.length;
    showToast(
      total === 0
        ? `Version ${next.version} added`
        : missing.length
        ? `Version ${next.version} added · ${moved} of ${total} highlights moved, ${missing.length} not found`
        : `Version ${next.version} added · all ${moved} highlights moved`,
    );
    if (connected) sendContextualUpdate(`[The user replaced "${base.title}" with version ${next.version}. ${describeDoc(next)}]`);
  };

  /** Pages view measured where a carried-over highlight now sits. */
  const relocateHighlight = (docId: string, highlightId: string, rects: Highlight["rects"]) => {
    updateDocById(docId, (d) => ({
      ...d,
      highlights: (d.highlights || []).map((h) => (h.id === highlightId ? { ...h, rects, missing: rects.length === 0 } : h)),
    }));
  };

  /** Scans for figure pages in the background so opening a book stays fast. */
  const findFigures = async (docId: string, fileId: string) => {
    try {
      const pages = await scanFigurePages(fileId);
      if (!shelfDocsRef.current.some((d) => d.id === docId)) return;
      updateDocById(docId, (cur) => ({ ...cur, figurePages: pages }));
      if (pages.length) showToast(`Found figures on ${pages.length} pages`);
    } catch (e) {
      console.warn("Figure scan failed", e);
    }
  };

  findFiguresRef.current = findFigures;

  const closeDocument = () => {
    if (docRef.current) removeDocument(docRef.current.id);
  };

  const onParagraphAction = (index: number, action: ParagraphAction) => {
    const d = docRef.current;
    if (!d) return;
    if (paused) togglePause();
    if (action === "explain") {
      const p = d.paragraphs[index];
      say(`Can you explain this part${p.page ? ` on page ${p.page}` : ""}? "${p.text.slice(0, 400)}${p.text.length > 400 ? "..." : ""}"`);
    }
  };

  /** The reader reports where the user is as they scroll. */
  const onViewPosition = (pos: { index?: number; page?: number }) => {
    const d = docRef.current;
    if (!d) return;
    const index = pos.index ?? (pos.page ? Math.max(0, d.paragraphs.findIndex((p) => (p.page ?? 0) >= pos.page!)) : undefined);
    viewRef.current = { index, page: pos.page ?? (index !== undefined ? d.paragraphs[index]?.page : undefined) };
    // Remember the place (saved with the session) once scrolling settles.
    if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
    positionTimerRef.current = setTimeout(() => {
      if (index !== undefined && docRef.current && docRef.current.position !== index) updateDoc((cur) => ({ ...cur, position: index }));
    }, 1200);
    // During a call, quietly let the agent know when the user turns to a new page.
    const page = viewRef.current.page;
    if (connected && page && page !== lastAnnouncedPageRef.current) {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
      announceTimerRef.current = setTimeout(() => {
        if (viewRef.current.page !== page || page === lastAnnouncedPageRef.current) return;
        lastAnnouncedPageRef.current = page;
        if (convRef.current.status === "connected") convRef.current.sendContextualUpdate(`[The user is now on page ${page}.]`);
      }, 2500);
    }
  };

  const attachFile = (fileId: string, figurePages: number[]) => {
    updateDoc((cur) => ({ ...cur, fileId, figurePages }));
    showToast(figurePages.length ? `Pages saved · ${figurePages.length} with figures` : "Pages saved");
    if (connected && docRef.current) sendContextualUpdate(`[Page images are now available. ${describeDoc(docRef.current)}]`);
  };

  /** Asks about a page as the user, starting a call if needed. */
  const askAboutPage = (page: number) => {
    const question = `Can you explain what's on page ${page}, including any figures or diagrams?`;
    setTab("reader");
    if (connected) void sendPageToAgent(page, question, true);
    else if (phase !== "connecting") {
      pendingPageRef.current = { page, text: question };
      void startSession();
    }
  };

  // Stable wrappers so the memoized reader doesn't re-render on unrelated state changes.
  const latestRef = useRef({ openDocument, closeDocument, onParagraphAction, attachFile, askAboutPage });
  latestRef.current = { openDocument, closeDocument, onParagraphAction, attachFile, askAboutPage };
  const stableAttach = useCallback((id: string, figs: number[]) => latestRef.current.attachFile(id, figs), []);
  const stableAskPage = useCallback((page: number) => latestRef.current.askAboutPage(page), []);
  /** Copy / ask / note / highlight from the selection toolbar. */
  const onSelectionAction = (a: SelectionAction) => {
    if (a.type === "ask") {
      if (paused) togglePause();
      const where = a.page ? ` on page ${a.page}` : "";
      say(`Can you explain this${where}? "${a.text.slice(0, 700)}${a.text.length > 700 ? "..." : ""}"`);
    } else if (a.type === "note") {
      handleAppendCanvas({ markdown: `> ${a.text.replace(/\n+/g, " ")}${a.page ? `\n\n*Page ${a.page}*` : ""}`, source: "user", toolName: "selection" });
    } else if (a.type === "highlight") {
      const h = { id: `hl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, page: a.page, text: a.text, rects: a.rects, createdAt: new Date().toISOString() };
      updateDoc((cur) => ({ ...cur, highlights: [...(cur.highlights || []), h] }));
      showToast("Highlighted");
    } else if (a.type === "unhighlight") {
      updateDoc((cur) => ({ ...cur, highlights: (cur.highlights || []).filter((h) => !a.ids.includes(h.id)) }));
      showToast("Highlight removed");
    }
  };
  const selRef = useRef(onSelectionAction);
  selRef.current = onSelectionAction;
  const stableSelectionAction = useCallback((a: SelectionAction) => selRef.current(a), []);

  const viewPosRef = useRef(onViewPosition);
  viewPosRef.current = onViewPosition;
  const stableViewPosition = useCallback((pos: { index?: number; page?: number }) => viewPosRef.current(pos), []);
  const stableOpen = useCallback((d: ReadingDocument) => latestRef.current.openDocument(d), []);
  const shelfOpsRef = useRef({ switchDocument, removeDocument, addVersion, relocateHighlight });
  shelfOpsRef.current = { switchDocument, removeDocument, addVersion, relocateHighlight };
  const stableSwitch = useCallback((id: string) => shelfOpsRef.current.switchDocument(id), []);
  const stableRemove = useCallback((id: string) => shelfOpsRef.current.removeDocument(id), []);
  const stableAddVersion = useCallback((baseId: string, fresh: ReadingDocument) => shelfOpsRef.current.addVersion(baseId, fresh), []);
  const stableRelocate = useCallback(
    (docId: string, hid: string, rects: Highlight["rects"]) => shelfOpsRef.current.relocateHighlight(docId, hid, rects),
    [],
  );
  const stableClose = useCallback(() => latestRef.current.closeDocument(), []);
  const stableParagraphAction = useCallback((i: number, a: ParagraphAction) => latestRef.current.onParagraphAction(i, a), []);

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed) return;
    say(trimmed);
    setTextInput("");
  };

  const handleClearCanvas = useCallback(() => {
    commitCanvas([]);
    showToast("Notes cleared");
  }, [commitCanvas, showToast]);

  const copyMessageText = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  // ── One call state drives every indicator ──
  type CallState = "off" | "connecting" | "listening" | "speaking" | "muted" | "paused" | "reconnecting" | "dropped" | "saving" | "error";
  const callState: CallState = reconnecting
    ? "reconnecting"
    : phase === "connecting"
    ? "connecting"
    : connected
    ? isSpeaking
      ? "speaking"
      : isMuted
      ? "muted"
      : "listening"
    : paused
    ? "paused"
    : dropped
    ? "dropped"
    : phase === "error"
    ? "error"
    : phase === "finishing"
    ? "saving"
    : "off";
  const STATE: Record<CallState, { label: string; short: string; color: string; live?: boolean; pulse?: boolean }> = {
    off: { label: "Not connected", short: "Off", color: "var(--faint)" },
    connecting: { label: "Connecting...", short: "Connecting", color: "#e6a23c", pulse: true },
    listening: { label: "Live · listening", short: "Live", color: "var(--live)", live: true },
    speaking: { label: "Live · agent speaking", short: "Speaking", color: "var(--accent)", live: true },
    muted: { label: "Live · your mic is off", short: "Mic off", color: "#e6a23c", live: true },
    paused: { label: "Paused", short: "Paused", color: "#7aa2f7" },
    reconnecting: { label: "Reconnecting...", short: "Reconnecting", color: "#e6a23c", pulse: true },
    dropped: { label: "Disconnected", short: "Dropped", color: "var(--danger)" },
    saving: { label: "Saving...", short: "Saving", color: "var(--faint)" },
    error: { label: "Couldn't connect", short: "Error", color: "var(--danger)" },
  };
  const meta = STATE[callState];
  const orbState: OrbState =
    callState === "connecting" || callState === "reconnecting" ? "connecting" : callState === "speaking" ? "speaking" : meta.live ? "listening" : callState === "paused" ? "paused" : "idle";
  const statusLabel = meta.label;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number; mobileOnly?: boolean }[] = [
    { id: "reader", label: "Reader", icon: <BookOpen className="w-4 h-4" /> },
    { id: "notes", label: "Notes", icon: <NotebookPen className="w-4 h-4" />, badge: unseenNotes || undefined },
    { id: "chat", label: "Conversation", icon: <MessagesSquare className="w-4 h-4" />, mobileOnly: true },
  ];

  const subLabel =
    offline && (meta.live || callState === "reconnecting")
      ? "You're offline. Waiting for the network..."
      : meta.live
      ? `${formatTimer(elapsed)} · ${callState === "muted" ? "press M to unmute" : "it can hear you"}`
      : callState === "paused"
      ? "Call paused, conversation saved · Space to resume"
      : callState === "reconnecting"
      ? "Connection lost. Your conversation is saved"
      : callState === "dropped"
      ? "The call dropped. Your conversation is saved"
      : errorMsg && callState === "error"
      ? errorMsg
      : doc
      ? "Read along; ask or discuss anytime"
      : "Talk, or open something to read";

  const startLabel = callState === "dropped" || callState === "error" ? "Reconnect" : "Start talking";
  const startIcon = callState === "dropped" || callState === "error" ? <RotateCcw className="w-4 h-4" /> : <Mic className="w-4 h-4" />;
  const startCall = () => void startSession();
  const busy = phase === "connecting" || phase === "finishing" || reconnecting;

  /** A colored dot that pulses while the call is live or trying to connect. */
  const stateDot = (size = 8) => (
    <span className="relative inline-flex flex-shrink-0" style={{ width: size, height: size }} aria-hidden>
      {(meta.live || meta.pulse) && (
        <span className="absolute inset-0 rounded-full animate-ping" style={{ background: meta.color, opacity: meta.pulse ? 0.6 : 0.35 }} />
      )}
      <span className="relative rounded-full" style={{ width: size, height: size, background: meta.color }} />
    </span>
  );

  /** Always-visible call state in the top bar; tap to start, resume or reconnect. */
  const statusPill = (
    <button
      onClick={() => {
        if (callState === "paused") togglePause();
        else if (callState === "off" || callState === "dropped" || callState === "error") startCall();
      }}
      disabled={meta.live || meta.pulse || callState === "saving"}
      className="flex items-center gap-2 h-8 px-3 rounded-full border text-xs font-medium flex-shrink-0 disabled:cursor-default transition-colors"
      style={{
        borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} ${meta.live || callState === "dropped" ? 14 : 8}%, transparent)`,
      }}
      title={
        callState === "off"
          ? "Not connected. Click to start talking"
          : callState === "paused"
          ? "Paused. Click or press Space to resume"
          : callState === "dropped"
          ? "The call dropped. Click to reconnect"
          : statusLabel
      }
    >
      {stateDot()}
      <span className="hidden sm:inline whitespace-nowrap">{meta.short}</span>
      {meta.live && <span className="tabular-nums text-faint hidden md:inline">{formatTimer(elapsed)}</span>}
    </button>
  );

  /** Call buttons, laid out in a row or (collapsed rail) a column. */
  const callControls = (vertical: boolean) =>
    connected ? (
      <div className={`flex ${vertical ? "flex-col" : ""} items-center gap-1`}>
        <button
          onClick={() => setMuted(!isMuted)}
          className={`btn btn-icon ${isMuted ? "btn-on" : ""}`}
          title={isMuted ? "Turn mic on (M)" : "Turn mic off (M)"}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button onClick={togglePause} className={`btn ${vertical ? "btn-icon" : "flex-1"} btn-quiet`} title="Pause: ends the call and saves it (Space)">
          <Pause className="w-4 h-4" />
          {!vertical && <span>Pause</span>}
        </button>
        <button onClick={hangUp} className="btn btn-icon btn-danger" title="End the call">
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    ) : callState === "paused" ? (
      <div className={`flex ${vertical ? "flex-col" : ""} items-center gap-1`}>
        <button onClick={togglePause} className={`btn btn-primary ${vertical ? "btn-icon" : "flex-1"}`} title="Resume the call (Space)">
          <Play className="w-4 h-4" />
          {!vertical && <span>Resume</span>}
        </button>
        <button onClick={hangUp} className="btn btn-icon btn-quiet" title="End: stay disconnected">
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    ) : callState === "reconnecting" || callState === "connecting" ? (
      <div className={`flex ${vertical ? "flex-col" : ""} items-center gap-1`}>
        <button disabled className={`btn btn-quiet ${vertical ? "btn-icon" : "flex-1"}`}>
          <Loader2 className="w-4 h-4 animate-spin" />
          {!vertical && <span>{callState === "reconnecting" ? "Reconnecting" : "Connecting"}</span>}
        </button>
        <button onClick={hangUp} className="btn btn-icon btn-quiet" title="Stop trying">
          <X className="w-4 h-4" />
        </button>
      </div>
    ) : vertical ? (
      <button onClick={startCall} disabled={busy} className="btn btn-icon btn-primary" title={startLabel}>
        {startIcon}
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <button onClick={startCall} disabled={busy} className="btn btn-primary flex-1">
          {startIcon}
          {startLabel}
        </button>
      </div>
    );

  const conversationView = (
    <div className="h-full flex flex-col min-h-0">
      <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
        {transcript.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="font-serif text-lg">Nothing said yet</p>
            <p className="text-sm text-faint mt-1.5 leading-relaxed max-w-[26ch]">The conversation shows up here as you talk.</p>
            <div className="mt-6 text-xs text-faint space-y-1.5">
              <p>
                <span className="kbd">Space</span> pause or resume
              </p>
              <p>
                <span className="kbd">M</span> mute the mic
              </p>
            </div>
          </div>
        ) : (
          transcript.map((msg, index) => {
            if (msg.source === "system") {
              return (
                <p key={index} className="text-center text-xs text-faint fade-in">
                  {msg.message}
                </p>
              );
            }
            const isUser = msg.source === "user";
            return (
              <div key={index} className={`group flex flex-col ${isUser ? "items-end" : "items-start"} fade-in`}>
                <span className="eyebrow mb-1">{isUser ? "You" : "Agent"}</span>
                <div className="relative max-w-[92%]">
                  <p
                    className={`whitespace-pre-wrap leading-relaxed text-[0.93rem] ${
                      isUser ? "bg-raised border border-line rounded-2xl rounded-tr-md px-3.5 py-2" : "text-fg"
                    }`}
                  >
                    {msg.message}
                  </p>
                  <button
                    onClick={() => copyMessageText(index, msg.message)}
                    className={`absolute top-1 ${isUser ? "-left-7" : "-right-7"} p-1 text-faint hover:text-fg opacity-0 group-hover:opacity-100 transition-opacity`}
                    title="Copy"
                  >
                    {copiedIndex === index ? <Check className="w-3.5 h-3.5 text-live" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={handleSendText} className="p-3 border-t border-line flex items-center gap-2 flex-shrink-0">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder={connected ? "Type instead of talking..." : "Type to start a conversation..."}
          className="field"
        />
        <button type="submit" disabled={!textInput.trim() || phase === "connecting"} className="btn btn-icon btn-primary flex-shrink-0" title="Send">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );

  const progressPct = doc && doc.paragraphs.length ? Math.round(((doc.position + 1) / doc.paragraphs.length) * 100) : 0;
  const focusIdx = doc ? Math.max(doc.position, 0) : 0;
  const pageNow = doc?.paragraphs[focusIdx]?.page;
  const chromeHidden = immersive && !chromeVisible;

  const tabSwitcher = (
    <div className="flex items-center rounded-xl bg-sunken p-0.5" role="tablist" aria-label="Workspace">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => {
            setTab(t.id);
            if (t.id === "notes") setUnseenNotes(0);
          }}
          className={`btn h-8 px-3 ${t.mobileOnly ? "lg:hidden" : ""} ${tab === t.id ? "bg-raised !text-fg shadow-sm" : ""}`}
          title={t.label}
        >
          {t.icon}
          <span className="hidden xl:inline">{t.label}</span>
          {t.badge ? (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-accent-fg text-[0.7rem] font-semibold flex items-center justify-center">{t.badge}</span>
          ) : t.id === "notes" && canvasEntries.length > 0 ? (
            <span className="text-xs text-faint">{canvasEntries.length}</span>
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Top bar: title on the left, workspace switcher in the middle, reading tools and app actions on the right */}
      <header
        onMouseEnter={() => (chromeHoverRef.current = true)}
        onMouseLeave={() => (chromeHoverRef.current = false)}
        className={
          immersive
            ? `fixed inset-x-0 top-0 z-40 border-b border-line transition-all duration-300 ${chromeHidden ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100"}`
            : "flex-shrink-0"
        }
        style={immersive ? { background: "color-mix(in srgb, var(--bg) 86%, transparent)", backdropFilter: "blur(14px)" } : undefined}
      >
        <div className="h-14 px-3 sm:px-4 flex items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-2.5 overflow-hidden">
            <div
              className="w-6 h-6 rounded-full flex-shrink-0 hidden sm:block"
              style={{ background: "radial-gradient(circle at 35% 30%, #fff1d6, var(--accent) 55%, #9a5a1a)" }}
              aria-hidden
            />
            {doc ? (
              <DocSwitcher
                docs={shelfDocs}
                active={doc}
                subtitle={`${doc.position < 0 ? "Not started" : `${progressPct}% through`}${pageNow ? ` · page ${pageNow}${doc.pageCount ? ` of ${doc.pageCount}` : ""}` : ""}`}
                onSwitch={stableSwitch}
                onRemove={stableRemove}
                onAdd={() => {
                  setTab("reader");
                  setAdding({ kind: "new" });
                }}
                onNewVersion={(baseId) => {
                  setTab("reader");
                  setAdding({ kind: "version", baseId, title: doc.title });
                }}
              />
            ) : (
              <span className="font-serif text-[1.1rem] font-medium tracking-tight truncate">Voice Canvas</span>
            )}
          </div>

          {tabSwitcher}

          <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
            {statusPill}
            <div className="w-1" />
            <div ref={setToolsSlot} className={`hidden md:flex items-center ${tab === "reader" && doc ? "" : "!hidden"}`} />
            {tab === "reader" && doc && <div className="hidden md:block w-px h-5 bg-line mx-1" />}
            <button
              className={`btn btn-icon hidden sm:inline-flex ${captionsOn ? "btn-on" : ""}`}
              onClick={() => setCaptionsOn((v) => !v)}
              title={captionsOn ? "Hide live captions (C)" : "Show live captions (C)"}
              aria-pressed={captionsOn}
            >
              <CaptionsIcon className="w-4 h-4" />
            </button>
            <button
              className={`btn btn-icon hidden sm:inline-flex ${immersive ? "btn-on" : ""}`}
              onClick={toggleImmersive}
              title={immersive ? "Leave immersive mode (Esc or F)" : "Immersive reading, full screen (F)"}
            >
              {immersive ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
            {appActions}
          </div>
        </div>
        {/* A thin line in the call's state color: easy to catch from the corner of your eye. */}
        <div
          className={`h-[2px] transition-colors duration-500 ${meta.pulse ? "animate-pulse" : ""}`}
          style={{ background: meta.live || meta.pulse || callState === "dropped" || callState === "paused" ? meta.color : "transparent" }}
          aria-hidden
        />
      </header>

      {/* Workspace */}
      <div className={immersive ? "flex-1 min-h-0" : "flex-1 min-h-0 flex gap-3 px-3 pb-3 sm:px-4 sm:pb-4"}>
        <section
          className={
            immersive
              ? `h-full relative overflow-hidden bg-bg [&_article]:!pt-20 [&_[data-pages]]:!pt-20 ${chromeHidden ? "cursor-none" : ""}`
              : "panel rounded-2xl flex flex-col min-h-0 min-w-0 flex-1 relative overflow-hidden"
          }
        >
          <div className={`h-full min-h-0 ${immersive ? "" : "pb-[4.5rem] lg:pb-0"}`}>
            {tab === "reader" && (
              <ReaderPanel
                doc={doc}
                range={readRange}
                toolsSlot={toolsSlot}
                onOpen={stableOpen}
                onClose={stableClose}
                onParagraphAction={stableParagraphAction}
                onAskAboutPage={stableAskPage}
                onAttachFile={stableAttach}
                onViewPosition={stableViewPosition}
                onSelectionAction={stableSelectionAction}
                shelf={shelfDocs}
                onSwitchDocument={stableSwitch}
                onRemoveDocument={stableRemove}
                onAddVersion={stableAddVersion}
                onRelocateHighlight={stableRelocate}
                adding={adding}
                onAddingChange={setAdding}
              />
            )}
            {tab === "notes" && (
              <CanvasPanel
                entries={canvasEntries}
                onClear={handleClearCanvas}
                onUpdateEntry={(id, md) => handleUpdateCanvasEntry({ id, markdown: md })}
                onDeleteEntry={(id) => handleDeleteCanvasEntry(id)}
              />
            )}
            {tab === "chat" && <div className="h-full lg:hidden">{conversationView}</div>}
          </div>

          {captionsOn && (
            <Captions engine={captionEngine} bottom={immersive ? (chromeHidden ? "1.5rem" : "5.75rem") : isLarge ? "1.25rem" : "5.5rem"} />
          )}

          {/* Dropped call / offline: impossible to miss, and says the conversation is safe */}
          {(callState === "dropped" || (offline && (meta.live || callState === "reconnecting"))) && (
            <div className={`absolute left-1/2 -translate-x-1/2 z-30 ${immersive ? "top-20" : "top-3"} w-[min(34rem,calc(100%-2rem))] rise`}>
              <div className="rounded-xl border px-4 py-3 flex items-center gap-3 shadow-lg" style={{ background: "var(--surface)", borderColor: "var(--danger)" }}>
                <WifiOff className="w-5 h-5 flex-shrink-0 text-danger" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{offline ? "You're offline" : "The call dropped"}</div>
                  <div className="text-xs text-muted">Your conversation is saved. {offline ? "It will reconnect when the network is back." : "Reconnect to carry on where you left off."}</div>
                </div>
                {!offline && (
                  <button className="btn btn-primary h-8 text-xs" onClick={startCall}>
                    <RotateCcw className="w-3.5 h-3.5" /> Reconnect
                  </button>
                )}
                <button className="btn btn-icon h-8 w-8" onClick={() => setDropped(false)} title="Dismiss">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Toast */}
          {toastMsg && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-raised border border-line text-sm text-muted shadow-lg rise flex items-center gap-2 max-w-[90%] ${
                immersive ? "top-20" : "top-3"
              }`}
            >
              {toastMsg.startsWith("Searching") && <Search className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
              <span className="truncate">{toastMsg}</span>
            </div>
          )}

          {/* Phone-only dock: on large screens the controls live in the right rail */}
          {!immersive && (
            <div className="lg:hidden absolute left-3 right-3 bottom-3 z-10">
              <div className="panel rounded-2xl pl-3 pr-2 py-2 flex items-center gap-3" style={{ background: "color-mix(in srgb, var(--surface) 92%, transparent)" }}>
                <LiveOrb state={orbState} getLevel={connected ? getLevel : null} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{statusLabel}</div>
                  <div className="text-xs text-faint truncate">{subLabel}</div>
                </div>
                <div className="flex-shrink-0">{callControls(false)}</div>
              </div>
            </div>
          )}
        </section>

        {/* Right rail: voice controls + conversation. Collapses to a slim strip. */}
        {!immersive &&
          (railCollapsed ? (
            <aside className="panel rounded-2xl hidden lg:flex flex-col items-center gap-3 py-3 w-[68px] flex-shrink-0">
              <button className="btn btn-icon" onClick={() => setRailCollapsed(false)} title="Show conversation">
                <PanelRightOpen className="w-4 h-4" />
              </button>
              <div className="h-px w-8 bg-line" />
              <LiveOrb state={orbState} getLevel={connected ? getLevel : null} size={40} />
              <span className="text-[0.65rem] text-faint text-center leading-tight px-1">
                {meta.live ? formatTimer(elapsed) : meta.short}
              </span>
              {callControls(true)}
              {transcript.length > 0 && (
                <button className="btn btn-icon mt-auto relative" onClick={() => setRailCollapsed(false)} title={`${transcript.length} messages`}>
                  <MessagesSquare className="w-4 h-4" />
                </button>
              )}
            </aside>
          ) : (
            <aside className="panel rounded-2xl hidden lg:flex flex-col min-h-0 overflow-hidden w-[360px] flex-shrink-0">
              <div className="p-4 border-b border-line flex-shrink-0">
                <div className="flex items-center gap-3">
                  <LiveOrb state={orbState} getLevel={connected ? getLevel : null} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{statusLabel}</div>
                    <div className="text-xs text-faint truncate">{subLabel}</div>
                  </div>
                  <button className="btn btn-icon -mr-1" onClick={() => setRailCollapsed(true)} title="Collapse to give the reader more room">
                    <PanelRightClose className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-3">{callControls(false)}</div>
                {/* Menus anchor to this row so they span the rail instead of being clipped. */}
                <div className="mt-2.5 relative flex items-center justify-end gap-1.5">
                  <ModelPicker
                    model={llm}
                    live={connected}
                    onChange={saveModel}
                    onApplyNow={() => {
                      reconnectNoteRef.current = "Switching model...";
                      manualReconnectRef.current = true;
                      stopSession();
                    }}
                  />
                  <VoicePicker
                    voiceId={voiceId}
                    speed={voiceSpeed}
                    live={connected}
                    onChange={saveVoicePrefs}
                    onApplyNow={() => {
                      reconnectNoteRef.current = "Switching voice...";
                      manualReconnectRef.current = true;
                      stopSession();
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-line flex-shrink-0">
                <span className="text-sm font-medium flex items-center gap-2">
                  <MessagesSquare className="w-4 h-4 text-muted" /> Conversation
                </span>
                {transcript.length > 0 && <span className="text-xs text-faint">{transcript.length} messages</span>}
              </div>
              <div className="flex-1 min-h-0">{conversationView}</div>
            </aside>
          ))}
      </div>

      {/* Immersive: a small floating control pill that fades away while you read */}
      {immersive && (
        <div
          onMouseEnter={() => (chromeHoverRef.current = true)}
          onMouseLeave={() => (chromeHoverRef.current = false)}
          className={`fixed left-1/2 -translate-x-1/2 bottom-5 z-40 transition-all duration-300 ${
            chromeHidden ? "opacity-0 translate-y-4 pointer-events-none" : "opacity-100 translate-y-0"
          }`}
        >
          <div
            className="panel rounded-full pl-2 pr-1.5 py-1.5 flex items-center gap-2.5 max-w-[calc(100vw-2rem)]"
            style={{ background: "color-mix(in srgb, var(--surface) 90%, transparent)", backdropFilter: "blur(14px)" }}
          >
            <LiveOrb state={orbState} getLevel={connected ? getLevel : null} size={30} />
            <div className="min-w-0 hidden sm:block pr-1">
              <div className="text-sm font-medium leading-tight truncate max-w-[16rem]">{statusLabel}</div>
              <div className="text-[0.7rem] text-faint leading-tight truncate max-w-[16rem]">{subLabel}</div>
            </div>
            <div className="flex-shrink-0">{callControls(false)}</div>
          </div>
        </div>
      )}

      {/* While a call is live in immersive mode, a faint edge glow shows the agent is speaking even when the pill is hidden */}
      {immersive && chromeHidden && callState === "speaking" && (
        <div className="fixed inset-x-0 bottom-0 h-1 z-30 bg-accent/60 fade-in" style={{ boxShadow: "0 0 24px var(--accent)" }} aria-hidden />
      )}
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
