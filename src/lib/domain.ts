export function normalizeHost(input: string) {
  try {
    let h = input.trim().toLowerCase();
    if (h.includes("://")) h = new URL(h).hostname;
    h = h.replace(/^www\./, "");
    return h;
  } catch {
    return input.trim().toLowerCase().replace(/^www\./, "");
  }
}

export function hostOf(url: string) {
  try {
    let h = new URL(url).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

/** Boundary-aware: apetsaude.com.br matches; vitapetsaude.com.br does not. */
export function hostMatchesOfficial(host: string, officialHosts: string[]) {
  const h = normalizeHost(host);
  for (const raw of officialHosts) {
    const o = normalizeHost(raw);
    if (!o) continue;
    if (h === o || h.endsWith("." + o)) return true;
  }
  return false;
}

export function siteHit(blob: string, officialHosts: string[]) {
  for (const raw of officialHosts) {
    const o = normalizeHost(raw);
    if (!o) continue;
    const escaped = o.replace(/\./g, "\\.");
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}`, "i");
    if (re.test(blob)) return true;
  }
  return false;
}

export function brandRoot(host: string, officialHosts: string[]) {
  if (hostMatchesOfficial(host, officialHosts)) return normalizeHost(officialHosts[0]);
  if (/(^|\.)petlove\.com\.br$/.test(host)) return "petlove.com.br";
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join(".");
  if (["com.br", "org.br", "gov.br", "net.br", "ia.br"].includes(last2)) {
    return parts.slice(-3).join(".");
  }
  return last2;
}

const SOCIAL = new Set([
  "instagram.com",
  "facebook.com",
  "fb.com",
  "m.facebook.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "wa.me",
  "whatsapp.com",
  "web.whatsapp.com",
]);

export function isSocial(host: string) {
  return SOCIAL.has(host);
}
