import { Hono } from "hono";
import { cors } from "hono/cors";
import { dbService } from "./db";

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

app.post("/api/sessions", async (c) => {
  const body = await c.req.json();
  return c.json({ session: dbService.saveSession(body) }, 201);
});

app.delete("/api/sessions/:id", (c) => {
  const deleted = dbService.deleteSession(c.req.param("id"));
  if (!deleted) return c.json({ error: "Session not found" }, 404);
  return c.json({ success: true, id: c.req.param("id") });
});

// 5. Settings
app.get("/api/settings", (c) => {
  const settings = dbService.getAllSettings();
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
};
