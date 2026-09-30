import { normalizeHost } from "./domain";

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export type SiteCrawl = {
  url: string;
  host: string;
  title: string;
  text: string;
  links: string[];
};

export async function crawlHomepage(siteUrl: string): Promise<SiteCrawl> {
  let url = siteUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SeoGeoBot/1.0)",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Falha ao abrir o site (${res.status})`);
  const html = await res.text();
  const finalUrl = res.url || url;
  const host = normalizeHost(finalUrl);
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || host;
  const text = stripHtml(html).slice(0, 12000);
  const links: string[] = [];
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    links.push(m[1]);
    if (links.length > 80) break;
  }
  return { url: finalUrl, host, title, text, links };
}

export async function crawlBlogHints(siteUrl: string, host: string) {
  let base = siteUrl.trim();
  if (!/^https?:\/\//i.test(base)) base = "https://" + base;
  const origin = new URL(base).origin;
  const candidates = [`${origin}/sitemap.xml`, `${origin}/blog`, `${origin}/blog/`];
  const titles: string[] = [];
  for (const u of candidates) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoGeoBot/1.0)" },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const body = await res.text();
      if (u.includes("sitemap")) {
        const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
        for (const loc of locs.slice(0, 30)) {
          if (!loc.includes(host) && !loc.includes(origin.replace(/^https?:\/\//, ""))) continue;
          const slug = decodeURIComponent(loc.split("/").filter(Boolean).pop() || "")
            .replace(/[-_]/g, " ")
            .replace(/\.\w+$/, "");
          if (slug.length > 8) titles.push(slug);
        }
      } else {
        for (const m of body.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)) {
          const t = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (t.length > 12) titles.push(t);
        }
      }
      if (titles.length >= 10) break;
    } catch {
      /* ignore */
    }
  }
  return [...new Set(titles)].slice(0, 10);
}
