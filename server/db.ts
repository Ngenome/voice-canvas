import { Database } from "bun:sqlite";
import path from "path";

// Initialize SQLite database
const dbPath = path.join(process.cwd(), "voice_sessions.db");
const db = new Database(dbPath, { create: true });

// Enable WAL mode for better performance
db.exec("PRAGMA journal_mode = WAL;");

// Backward-compatible schema migration: add canvas_json for app-side tool output
function ensureCanvasColumn() {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "canvas_json")) {
    db.exec("ALTER TABLE sessions ADD COLUMN canvas_json TEXT;");
  }
  if (!columns.some((column) => column.name === "document_json")) {
    db.exec("ALTER TABLE sessions ADD COLUMN document_json TEXT;");
  }
  if (!columns.some((column) => column.name === "summary_json")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_json TEXT;");
  }
}

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    agent_id TEXT,
    status TEXT DEFAULT 'completed',
    duration_seconds INTEGER DEFAULT 0,
    analysis_json TEXT,
    canvas_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'system')),
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

`);

ensureCanvasColumn();

export interface Session {
  id: string;
  title: string;
  agent_id?: string;
  status: string;
  duration_seconds: number;
  analysis_json?: string;
  canvas_json?: string;
  document_json?: string;
  document_title?: string;
  document_count?: number;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface Transcript {
  id: string;
  session_id: string;
  role: "user" | "agent" | "system";
  message: string;
  timestamp: string;
}

export interface CanvasEntry {
  id: string;
  markdown: string;
  source?: "agent" | "user" | "tool" | "system";
  createdAt?: string;
  toolName?: string;
}

export interface FullSession extends Session {
  transcripts: Transcript[];
}

export const dbService = {
  getAllSessions(): Session[] {
    const query = db.prepare(`
      SELECT
        s.id, s.title, s.agent_id, s.status, s.duration_seconds, s.canvas_json,
        s.created_at, s.updated_at,
        COALESCE(json_extract(s.document_json, '$.title'), json_extract(s.document_json, '$.documents[0].title')) as document_title,
        -- Documents on the shelf, counting all versions of one document once.
        CASE
          WHEN s.document_json IS NULL THEN 0
          WHEN json_extract(s.document_json, '$.documents') IS NULL THEN 1
          ELSE (SELECT COUNT(DISTINCT COALESCE(json_extract(d.value, '$.groupId'), json_extract(d.value, '$.id')))
                  FROM json_each(s.document_json, '$.documents') d)
        END as document_count,
        COUNT(t.id) as message_count
      FROM sessions s
      LEFT JOIN transcripts t ON s.id = t.session_id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);
    return query.all() as Session[];
  },

  getSessionById(id: string): FullSession | null {
    const sessionQuery = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    const session = sessionQuery.get(id) as Session | null;
    if (!session) return null;

    const transcriptQuery = db.prepare(`
      SELECT * FROM transcripts 
      WHERE session_id = ? 
      ORDER BY timestamp ASC
    `);
    const transcripts = transcriptQuery.all(id) as Transcript[];

    return {
      ...session,
      transcripts,
    };
  },

  saveSession(sessionData: {
    id: string;
    title: string;
    agent_id?: string;
    status?: string;
    duration_seconds?: number;
    analysis_json?: string;
    canvas_entries?: CanvasEntry[];
    canvas_json?: string;
    document_json?: string;
    transcripts?: { role: "user" | "agent" | "system"; message: string; timestamp?: string }[];
  }): FullSession {
    const {
      id,
      title,
      agent_id = "",
      status = "completed",
      duration_seconds = 0,
      analysis_json = null,
      canvas_entries = [],
      canvas_json = null,
      document_json = null,
      transcripts = [],
    } = sessionData;

    let finalCanvasJson: string | null = null;
    if (typeof canvas_json === "string" && canvas_json.trim()) {
      finalCanvasJson = canvas_json.trim();
    } else if (Array.isArray(canvas_entries) && canvas_entries.length > 0) {
      finalCanvasJson = JSON.stringify(canvas_entries);
    }

    const insertSession = db.prepare(`
      INSERT INTO sessions (id, title, agent_id, status, duration_seconds, analysis_json, canvas_json, document_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        duration_seconds = excluded.duration_seconds,
        analysis_json = COALESCE(excluded.analysis_json, sessions.analysis_json),
        canvas_json = COALESCE(excluded.canvas_json, sessions.canvas_json),
        document_json = COALESCE(excluded.document_json, sessions.document_json),
        updated_at = CURRENT_TIMESTAMP
    `);

    insertSession.run(
      id,
      title,
      agent_id,
      status,
      duration_seconds,
      analysis_json,
      finalCanvasJson,
      typeof document_json === "string" && document_json.trim() ? document_json : null,
    );

    // Delete existing transcripts for clean rewrite
    db.prepare(`DELETE FROM transcripts WHERE session_id = ?`).run(id);

    const insertTranscript = db.prepare(`
      INSERT INTO transcripts (id, session_id, role, message, timestamp)
      VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    for (const item of transcripts) {
      const transcriptId = `tr_${Math.random().toString(36).substring(2, 9)}`;
      insertTranscript.run(transcriptId, id, item.role, item.message, item.timestamp || null);
    }

    return this.getSessionById(id)!;
  },

  updateSessionAnalysis(id: string, analysisJson: string): void {
    const stmt = db.prepare(`
      UPDATE sessions SET analysis_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(analysisJson, id);
  },

  updateSessionCanvasEntries(id: string, canvasEntries: CanvasEntry[] | string): void {
    let canvasJson: string | null = null;
    if (typeof canvasEntries === "string") {
      canvasJson = canvasEntries;
    } else if (Array.isArray(canvasEntries)) {
      canvasJson = canvasEntries.length > 0 ? JSON.stringify(canvasEntries) : JSON.stringify([]);
    }

    const stmt = db.prepare(`
      INSERT INTO sessions (id, title, status, canvas_json, updated_at)
      VALUES (?, 'Live Voice Session', 'active', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        canvas_json = excluded.canvas_json,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(id, canvasJson);
  },

  updateSessionDocument(id: string, documentJson: string, title?: string): void {
    const stmt = db.prepare(`
      INSERT INTO sessions (id, title, status, document_json, updated_at)
      VALUES (?, ?, 'active', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        document_json = excluded.document_json,
        title = CASE WHEN ? <> '' THEN ? ELSE sessions.title END,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(id, title || "Reading session", documentJson, title || "", title || "");
  },

  /** Rolling summary of the older part of a long conversation: { text, covered }. */
  updateSessionSummary(id: string, summaryJson: string): void {
    db.prepare(`
      INSERT INTO sessions (id, title, status, summary_json, updated_at)
      VALUES (?, 'Conversation', 'active', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET summary_json = excluded.summary_json, updated_at = CURRENT_TIMESTAMP
    `).run(id, summaryJson);
  },

  deleteSession(id: string): boolean {
    const stmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  },

  getSetting(key: string): string | null {
    const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
    const row = stmt.get(key) as { value: string } | null;
    return row ? row.value : null;
  },

  setSetting(key: string, value: string): void {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(key, value);
  },

  getAllSettings(): Record<string, string> {
    const stmt = db.prepare(`SELECT key, value FROM settings`);
    const rows = stmt.all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }
};
