// Web search and page reading, via the local server (which caches results, retries
// around Exa's free rate limit, and falls back to DuckDuckGo / Jina Reader).

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export async function webSearch(query: string, objective?: string, numResults = 5): Promise<string> {
  return (await post<{ text: string }>("/api/web/search", { query, objective, numResults })).text;
}

export async function readWebpage(urls: string[], maxCharacters = 4000): Promise<string> {
  return (await post<{ text: string }>("/api/web/read", { urls, maxCharacters })).text;
}
