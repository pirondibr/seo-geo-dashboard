const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export function openRouterKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY não configurada");
  return key;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OrCitation = { url: string; title: string };

export type OrResult = {
  content: string;
  citations: OrCitation[];
  searches: number;
  searched: boolean;
  cost: number;
  raw: unknown;
};

function extractCitations(data: any): OrCitation[] {
  const out: OrCitation[] = [];
  const seen = new Set<string>();
  const push = (url?: string, title?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: title || url });
  };

  const message = data?.choices?.[0]?.message;
  const annotations = message?.annotations || [];
  for (const a of annotations) {
    if (a?.type === "url_citation" && a.url_citation) {
      push(a.url_citation.url, a.url_citation.title);
    }
  }

  const details = data?.usage?.server_tool_use_details || data?.usage?.server_tool_use;
  // also scan content for markdown links
  const content = String(message?.content || "");
  for (const m of content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    push(m[2], m[1]);
  }

  return out;
}

function extractSearches(data: any, citations: OrCitation[]) {
  const u = data?.usage || {};
  const details = u.server_tool_use_details || u.server_tool_use || {};
  const n = Number(details.web_search_requests || details.web_search || 0) || 0;
  if (n > 0) return n;
  if (citations.length) return 1;
  return 0;
}

export async function chatCompletion(opts: {
  model: string;
  messages: ChatMessage[];
  webSearch?: boolean;
  temperature?: number;
  timeoutMs?: number;
  /** Default: 1 for webSearch (avoid double billing), 2 otherwise */
  retries?: number;
}): Promise<OrResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    usage: { include: true },
  };
  if (opts.webSearch) {
    body.tools = [
      {
        type: "openrouter:web_search",
        parameters: { engine: "auto", max_results: 5 },
      },
    ];
  }

  const timeoutMs = opts.timeoutMs ?? (opts.webSearch ? 45000 : 40000);
  const maxAttempts = Math.max(1, opts.retries ?? (opts.webSearch ? 1 : 2));
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(OPENROUTER, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "https://seo-geo-dashboard-omega.vercel.app",
          "X-Title": "SEO GEO Dashboard",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        lastErr = new Error(`OpenRouter ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || `OpenRouter ${res.status}`);
      }
      const content = String(data?.choices?.[0]?.message?.content || "");
      const citations = extractCitations(data);
      const searches = extractSearches(data, citations);
      return {
        content,
        citations,
        searches,
        searched: searches > 0,
        cost: Number(data?.usage?.cost || 0) || 0,
        raw: data,
      };
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? `OpenRouter timeout (${timeoutMs}ms)`
          : e instanceof Error
            ? e.message
            : String(e);
      lastErr = new Error(msg);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("OpenRouter falhou");
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onEach?: (result: R, index: number) => Promise<void> | void
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const result = await fn(items[idx], idx);
      out[idx] = result;
      if (onEach) await onEach(result, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}
