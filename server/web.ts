// Web search and page reading for the agent, done on the local server so we can
// cache, retry around rate limits, and fall back to other providers.
//
// Order: Exa (free hosted MCP, or your key if EXA_API_KEY is set; retried on rate limits)
//        -> TinyFish Search / Fetch (free daily allowance; needs TINYFISH_API_KEY)
//        -> DuckDuckGo HTML results / Jina Reader (no key) as a last resort.

const EXA_KEY = process.env.EXA_API_KEY;
const TINYFISH_KEY = process.env.TINYFISH_API_KEY;
const EXA_URL = EXA_KEY ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(EXA_KEY)}` : "https://mcp.exa.ai/mcp";
const MAX_CHARS = 8000;
const CACHE_MS = 10 * 60 * 1000;

type Provider = [name: string, run: () => Promise<string>];

const cache = new Map<string, { at: number; text: string; via: string }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

function clip(text: string) {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]` : text;
}

// ── Exa ────────────────────────────────────────────────
async function callExa(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(EXA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429) throw new RateLimited("rate limited (429)");
  const body = await res.text();
  if (!res.ok) throw new Error(`error ${res.status}`);
  const line = body.trim().startsWith("{")
    ? body.trim()
    : body
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .pop()
        ?.slice(5)
        .trim();
  if (!line) throw new Error("empty response");
  const data = JSON.parse(line) as {
    result?: { content?: { text?: string }[]; isError?: boolean; _meta?: Record<string, unknown> };
    error?: { message?: string };
  };
  // The free endpoint reports rate limits as a normal-looking result with this flag.
  if (data.result?._meta?.["ai.exa/rateLimited"]) throw new RateLimited("free rate limit");
  if (data.error) throw new Error(data.error.message || "error");
  const text = (data.result?.content || []).map((c) => c.text || "").join("\n\n").trim();
  if (data.result?.isError) throw new Error(text || "tool error");
  return text;
}

/** The free limit clears within seconds, so a short backoff usually gets through. */
async function exaWithRetry(name: string, args: Record<string, unknown>) {
  // Kept short: in a voice call a quick fallback beats a long wait.
  const waits = [700, 1600];
  for (let i = 0; ; i++) {
    try {
      return await callExa(name, args);
    } catch (e) {
      if (!(e instanceof RateLimited) || i >= waits.length) throw e;
      await sleep(waits[i]);
    }
  }
}

// ── TinyFish (free daily allowance, needs a key) ───────
async function tinyfishSearch(query: string, n: number): Promise<string> {
  const res = await fetch(`https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`, {
    headers: { "X-API-Key": TINYFISH_KEY! },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`error ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; snippet?: string }[] };
  const results = (data.results || []).slice(0, n);
  if (!results.length) throw new Error("no results");
  return results.map((r) => `Title: ${r.title ?? ""}\nURL: ${r.url ?? ""}\n${r.snippet ?? ""}`).join("\n\n");
}

async function tinyfishFetch(urls: string[], maxChars: number): Promise<string> {
  const res = await fetch("https://api.fetch.tinyfish.ai", {
    method: "POST",
    headers: { "X-API-Key": TINYFISH_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ urls: urls.slice(0, 10), format: "markdown" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`error ${res.status}`);
  const data = (await res.json()) as { results?: { url: string; title?: string; text?: string }[]; errors?: { url: string; error: string }[] };
  const parts = (data.results || []).map((r) => `# ${r.title || r.url}\nURL: ${r.url}\n\n${(r.text || "").slice(0, maxChars)}`);
  if (!parts.length) throw new Error(data.errors?.[0]?.error || "nothing returned");
  return parts.join("\n\n");
}

// ── Last resort, no key ────────────────────────────────
async function duckDuckGo(query: string, n: number): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VoiceCanvas/1.0", Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`error ${res.status}`);
  const html = await res.text();
  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  const results: string[] = [];
  // Each result's wrapper carries several classes, one of them "result__body".
  for (const b of html.split(/class="[^"]*\bresult__body\b[^"]*"/).slice(1)) {
    if (results.length >= n) break;
    const link = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url = link[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    const snippet = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push(`Title: ${strip(link[2])}\nURL: ${url}\n${snippet ? strip(snippet[1]) : ""}`);
  }
  if (!results.length) throw new Error("no results");
  return results.join("\n\n");
}

async function jinaReader(url: string, maxChars: number): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, { headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`error ${res.status}`);
  return (await res.text()).slice(0, maxChars);
}

// ── Orchestration ──────────────────────────────────────
async function firstThatWorks(label: string, providers: Provider[]) {
  let lastError: unknown;
  for (const [name, run] of providers) {
    try {
      return { text: await run(), via: name };
    } catch (e) {
      lastError = e;
      console.warn(`[web] ${label} via ${name} failed: ${(e as Error).message}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

async function cachedRun(key: string, label: string, providers: Provider[]) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { text: hit.text, via: `${hit.via} (cached)` };
  const r = await firstThatWorks(label, providers);
  cache.set(key, { at: Date.now(), ...r });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return r;
}

export async function webSearch(query: string, objective?: string, numResults = 5): Promise<{ text: string; via: string }> {
  const providers: Provider[] = [["exa", () => exaWithRetry("web_search_exa", { query, objective: objective?.trim() || query, numResults })]];
  if (TINYFISH_KEY) providers.push(["tinyfish", () => tinyfishSearch(query, numResults)]);
  providers.push(["duckduckgo", () => duckDuckGo(query, numResults)]);
  const r = await cachedRun(`s:${query}:${numResults}`, "search", providers);
  return { text: clip(r.text || "No results found."), via: r.via };
}

export async function readWebpage(urls: string[], maxCharacters = 4000): Promise<{ text: string; via: string }> {
  const providers: Provider[] = [["exa", () => exaWithRetry("web_fetch_exa", { urls, maxCharacters })]];
  if (TINYFISH_KEY) providers.push(["tinyfish", () => tinyfishFetch(urls, maxCharacters)]);
  providers.push([
    "jina",
    async () => (await Promise.all(urls.slice(0, 3).map((u) => jinaReader(u, maxCharacters).then((t) => `# ${u}\n${t}`)))).join("\n\n"),
  ]);
  const r = await cachedRun(`r:${urls.join("|")}:${maxCharacters}`, "read", providers);
  return { text: clip(r.text || "The page had no readable text."), via: r.via };
}

export const webStatus = () => ({
  exa: EXA_KEY ? "your key" : "free (rate-limited, retried)",
  tinyfish: TINYFISH_KEY ? "enabled" : "add TINYFISH_API_KEY to enable",
  lastResort: "duckduckgo + jina reader",
});
