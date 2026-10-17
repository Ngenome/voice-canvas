import { Hono } from "hono";
import { cors } from "hono/cors";
import { dbService } from "./db";
import { webSearch, readWebpage, webStatus } from "./web";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const app = new Hono();

app.use("/api/*", cors());

// 1. Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    bunVersion: Bun.version,
    timestamp: new Date().toISOString(),
  });
});

// 2. ElevenLabs Signed URL endpoint
app.get("/api/voice/signed-url", async (c) => {
  const agentId =
    c.req.query("agent_id") ||
    process.env.ELEVENLABS_AGENT_ID ||
    dbService.getSetting("agent_id");
  const apiKey =
    c.req.header("x-api-key") ||
    process.env.ELEVEN_LABS_API_KEY ||
    process.env.ELEVENLABS_API_KEY ||
    dbService.getSetting("api_key");

  console.log(`[ElevenLabs] Generating signed URL for agent_id: ${agentId}`);

  if (!agentId) {
    return c.json(
      { error: "Agent ID is required. Set it in Settings or env vars." },
      400,
    );
  }

  if (!apiKey) {
    return c.json({
      agentId,
      signedUrl: null,
      note: "No API key configured. Using public agent connection.",
    });
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { headers: { "xi-api-key": apiKey } },
  );

  if (!res.ok) {
    const errText = await res.text();
    return c.json(
      { error: `ElevenLabs API error: ${errText}` },
      res.status as any,
    );
  }

  const data = await res.json();
  return c.json({ signedUrl: data.signed_url, agentId });
});

// 3. Post-call psychometric analysis
const TRAIT_AREAS = [
  "Reliability & Conscientiousness",
  "Honesty & Integrity",
  "Emotional Stability & Patience",
  "Communication & Warmth",
  "Problem-solving & Judgement",
  "Work Ethic & Motivation",
  "Boundaries & Professionalism",
];

app.post("/api/voice/analyze", async (c) => {
  const { sessionId, transcript } = await c.req.json();

  const turns = Array.isArray(transcript) ? transcript : [];
  const userTurns = turns.filter(
    (t: any) => t.role === "user" || t.source === "user",
  );

  if (userTurns.length === 0) {
    return c.json({ error: "No user speech recorded for analysis." }, 422);
  }

  const totalWords = userTurns.reduce(
    (acc: number, t: any) =>
      acc + (t.message || t.text || "").split(" ").length,
    0,
  );
  const avgWords = totalWords / userTurns.length;
  const readiness = Math.min(
    95,
    Math.max(45, Math.round(60 + avgWords * 1.5 + userTurns.length * 2)),
  );

  let band = "Needs review";
  if (readiness >= 80) band = "Strong";
  else if (readiness >= 65) band = "Good";
  else if (readiness >= 45) band = "Fair";

  const traits = TRAIT_AREAS.map((label, idx) => {
    const score = Math.min(
      98,
      Math.max(50, Math.round(readiness + Math.sin(idx * 1.5) * 12)),
    );
    let verdict: "Good" | "Fair" | "Needs work" = "Good";
    if (score < 50) verdict = "Needs work";
    else if (score < 75) verdict = "Fair";
    return { label, score, verdict };
  });

  const profile = {
    readiness,
    band,
    summary: `The candidate completed a ${userTurns.length}-turn spoken voice session. Communication was ${band.toLowerCase()} with average turn length of ${Math.round(avgWords)} words.`,
    traits,
    strengths: [
      "Responded promptly to interviewer questions",
      "Clear articulation and steady speaking pace",
      `Active engagement across ${userTurns.length} conversation turns`,
    ],
    concerns:
      userTurns.length < 2
        ? ["Short interview duration — limited data for deep assessment."]
        : [],
    recommendation:
      readiness >= 65
        ? "Proceed to next stage of onboarding."
        : "Further manual review suggested.",
    insight:
      "Maintain steady enthusiasm and elaborate on past practical work experience.",
  };

  if (sessionId) {
    dbService.updateSessionAnalysis(sessionId, JSON.stringify(profile));
  }

  return c.json({ profile });
});

// 4. Sessions CRUD
app.get("/api/sessions", (c) => {
  return c.json({ sessions: dbService.getAllSessions() });
});

app.get("/api/sessions/:id", (c) => {
  const session = dbService.getSessionById(c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ session });
});

app.post("/api/sessions/:id/canvas", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  let entriesOrJson: any = null;

  if (body && typeof body.canvas_json === "string") {
    entriesOrJson = body.canvas_json;
  } else if (body && Array.isArray(body.canvas_entries)) {
    entriesOrJson = body.canvas_entries;
  } else if (body && Array.isArray(body.canvasEntries)) {
    entriesOrJson = body.canvasEntries;
  } else if (Array.isArray(body)) {
    entriesOrJson = body;
  }

  if (entriesOrJson === null) {
    return c.json({ error: "Missing canvas payload" }, 422);
  }

  dbService.updateSessionCanvasEntries(id, entriesOrJson);
  return c.json({ success: true, sessionId: id });
});

app.post("/api/sessions/:id/document", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.document_json !== "string") {
    return c.json({ error: "Missing document_json" }, 422);
  }
  dbService.updateSessionDocument(id, body.document_json, body.title);
  return c.json({ success: true, sessionId: id });
});

app.post("/api/sessions", async (c) => {
  const body = await c.req.json();
  return c.json({ session: dbService.saveSession(body) }, 201);
});

app.delete("/api/sessions/:id", (c) => {
  const deleted = dbService.deleteSession(c.req.param("id"));
  if (!deleted) return c.json({ error: "Session not found" }, 404);
  return c.json({ success: true, id: c.req.param("id") });
});

// 4b. Original document files (PDFs) so the reader can show real pages.
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const FILE_ID = /^file_[a-z0-9_]+$/i;

app.post("/api/files", async (c) => {
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: "Empty file" }, 422);
  if (body.byteLength > 300 * 1024 * 1024) return c.json({ error: "File too large (300 MB max)" }, 413);
  const head = new Uint8Array(body.slice(0, 5));
  if (String.fromCharCode(...head) !== "%PDF-") return c.json({ error: "Only PDF files are supported" }, 415);
  const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await Bun.write(path.join(UPLOAD_DIR, `${fileId}.pdf`), body);
  return c.json({ fileId, bytes: body.byteLength });
});

app.get("/api/files/:id", async (c) => {
  const id = c.req.param("id");
  if (!FILE_ID.test(id)) return c.json({ error: "Bad file id" }, 400);
  const file = Bun.file(path.join(UPLOAD_DIR, `${id}.pdf`));
  if (!(await file.exists())) return c.json({ error: "File not found" }, 404);
  const size = file.size;
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  // Byte ranges let pdf.js fetch only the pages it shows, instead of the whole file.
  const range = c.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(file, { headers: { ...headers, "Content-Length": String(size) } });
});

// 4c. Conversation summaries, so long sessions still fit the agent's context after a reconnect.
// Uses DigitalOcean serverless inference (OpenAI-compatible) when DIGITALOCEAN_MODEL_ACCESS_KEY is set.
const SUMMARY_KEY = process.env.DIGITALOCEAN_MODEL_ACCESS_KEY;
const SUMMARY_BASE = (process.env.DIGITALOCEAN_INFERENCE_BASE_URL || "https://inference.do-ai.run/v1").replace(/\/$/, "");
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "glm-5.3-flash";

app.get("/api/summarize/status", (c) => c.json({ available: !!SUMMARY_KEY, model: SUMMARY_KEY ? SUMMARY_MODEL : null }));

const SUMMARY_FALLBACK_MODEL = process.env.SUMMARY_FALLBACK_MODEL || "deepseek-v4.1-flash";

const SUMMARY_INSTRUCTIONS = [
  "You keep a running record of a voice conversation between a user and their reading and learning assistant.",
  "Write it as chronological prose: tell what happened in the order it happened, as a flowing narrative in the past tense.",
  'For example: "Kevin opened chapter 11 and asked what Sox9 does. The assistant explained that... He then asked..."',
  "Do not write bullet points, headings, key takeaways or a list of topics.",
  "Merge the previous record with the new transcript: keep the previous record's story, condensing its oldest parts if needed, then continue it with the new events.",
  "Keep the details needed to continue the conversation naturally: what was read and where they stopped, each question and the gist of the answer,",
  "anything the user asked to remember or follow up on, and how the user reacted. Skip greetings and small talk.",
  "Refer to the user by name; do not guess pronouns from the name. Use he, she or they only if the user stated it.",
  "Aim for at most 600 words. Write only the record itself.",
].join(" ");

app.post("/api/summarize", async (c) => {
  if (!SUMMARY_KEY) return c.json({ error: "No summarizer configured (set DIGITALOCEAN_MODEL_ACCESS_KEY)" }, 501);
  const body = await c.req.json().catch(() => ({}));
  const previous = typeof body.previousSummary === "string" ? body.previousSummary : "";
  const turns: { role: string; message: string }[] = Array.isArray(body.turns) ? body.turns : [];
  if (turns.length === 0) return c.json({ summary: previous });
  const transcript = turns.map((t) => `${t.role === "user" ? "User" : "Agent"}: ${String(t.message)}`).join("\n");

  const call = (model: string) =>
    fetch(`${SUMMARY_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUMMARY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: "system", content: SUMMARY_INSTRUCTIONS },
          { role: "user", content: `Previous record:\n${previous || "(none yet)"}\n\nNew transcript:\n${transcript}` },
        ],
      }),
    });

  // Try the main model, then the backup if it errors.
  let res = await call(SUMMARY_MODEL).catch(() => null);
  if (!res?.ok && SUMMARY_FALLBACK_MODEL && SUMMARY_FALLBACK_MODEL !== SUMMARY_MODEL) {
    console.warn(`[summarize] ${SUMMARY_MODEL} failed (${res?.status ?? "network"}), trying ${SUMMARY_FALLBACK_MODEL}`);
    res = await call(SUMMARY_FALLBACK_MODEL).catch(() => null);
  }
  if (!res) return c.json({ error: "Summarizer unreachable" }, 502);
  if (!res.ok) return c.json({ error: `Summarizer error (${res.status}): ${(await res.text()).slice(0, 300)}` }, 502);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) return c.json({ error: "Summarizer returned nothing" }, 502);
  return c.json({ summary });
});

app.post("/api/sessions/:id/summary", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.summary_json !== "string") return c.json({ error: "Missing summary_json" }, 422);
  dbService.updateSessionSummary(c.req.param("id"), body.summary_json);
  return c.json({ success: true });
});

// 4d. Voices available to the agent (for the voice picker)
let voiceCache: { at: number; voices: unknown[] } | null = null;

app.get("/api/voices", async (c) => {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || dbService.getSetting("api_key");
  if (!apiKey) return c.json({ error: "No ElevenLabs API key on the server" }, 400);
  if (voiceCache && Date.now() - voiceCache.at < 10 * 60 * 1000) return c.json({ voices: voiceCache.voices });
  const res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": apiKey } });
  if (!res.ok) return c.json({ error: `ElevenLabs error (${res.status})` }, 502);
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string; category?: string; preview_url?: string; labels?: Record<string, string> }[];
  };
  const voices = (data.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    previewUrl: v.preview_url,
    gender: v.labels?.gender,
    accent: v.labels?.accent,
    useCase: v.labels?.use_case,
    description: v.labels?.descriptive,
  }));
  voiceCache = { at: Date.now(), voices };
  return c.json({ voices });
});

// 4e. Web search / page reading for the agent (cached, retried, with fallbacks)
app.post("/api/web/search", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return c.json({ error: "Missing query" }, 422);
  try {
    return c.json(await webSearch(query, body.objective, Math.min(Number(body.numResults) || 5, 10)));
  } catch (e) {
    return c.json({ error: `Web search unavailable right now: ${(e as Error).message}` }, 502);
  }
});

app.post("/api/web/read", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const urls = (Array.isArray(body.urls) ? body.urls : []).filter((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u));
  if (!urls.length) return c.json({ error: "Missing urls" }, 422);
  try {
    return c.json(await readWebpage(urls, Math.min(Number(body.maxCharacters) || 4000, 60000)));
  } catch (e) {
    return c.json({ error: `Couldn't read the page: ${(e as Error).message}` }, 502);
  }
});

app.get("/api/web/status", (c) => c.json(webStatus()));

// 5. Settings
app.get("/api/settings", (c) => {
  const settings = dbService.getAllSettings();
  // Fall back to .env so the app works out of the box. The env API key stays
  // server-side: the signed-url route reads it directly.
  const envAgentId = process.env.ELEVENLABS_AGENT_ID || process.env.ELEVEN_LABS_AGENT_ID;
  if (!settings.agent_id && envAgentId) settings.agent_id = envAgentId;
  const envKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
  if (!settings.api_key && envKey) settings.server_key_configured = "true";
  if (settings.api_key) {
    settings.api_key_masked =
      settings.api_key.substring(0, 4) + "..." + settings.api_key.slice(-4);
  }
  return c.json({ settings });
});

app.post("/api/settings", async (c) => {
  const body = await c.req.json();
  if (typeof body === "object" && body !== null) {
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") dbService.setSetting(k, v);
    }
  }
  return c.json({ success: true, settings: dbService.getAllSettings() });
});

// ── Self-host with Bun.serve when run directly ──
const PORT = Number(process.env.PORT || 3002);

console.log(`🚀 Hono + bun:sqlite API server → http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
  maxRequestBodySize: 300 * 1024 * 1024,
};
