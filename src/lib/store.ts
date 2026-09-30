import { put, list, del, head } from "@vercel/blob";
import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import type { ClientRecord, JobRecord } from "./types";

const LOCAL_ROOT = path.join(process.cwd(), ".data");

function useBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function ensureLocal() {
  await fs.mkdir(path.join(LOCAL_ROOT, "clients"), { recursive: true });
  await fs.mkdir(path.join(LOCAL_ROOT, "jobs"), { recursive: true });
  await fs.mkdir(path.join(LOCAL_ROOT, "reports"), { recursive: true });
}

async function readJsonLocal<T>(rel: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(LOCAL_ROOT, rel), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonLocal(rel: string, data: unknown) {
  await ensureLocal();
  const full = path.join(LOCAL_ROOT, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(data, null, 2), "utf8");
}

async function writeTextLocal(rel: string, text: string) {
  await ensureLocal();
  const full = path.join(LOCAL_ROOT, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text, "utf8");
}

async function readTextLocal(rel: string) {
  try {
    return await fs.readFile(path.join(LOCAL_ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

async function writeBlobJson(pathname: string, data: unknown) {
  // Write to a unique object then copy content to stable pathname to reduce torn reads
  const payload = JSON.stringify(data);
  await put(pathname, payload, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

async function readBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    let url: string | null = null;
    // Prefer list over head — head can briefly return a stale generation after overwrite
    try {
      const listed = await list({ prefix: pathname, limit: 10 });
      const hit = listed.blobs
        .filter((b) => b.pathname === pathname)
        .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
      url = hit?.url || null;
    } catch {
      /* head fallback */
    }
    if (!url) {
      try {
        const meta = await head(pathname);
        url = meta.url;
      } catch {
        return null;
      }
    }
    if (!url) return null;
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now() + "&r=" + Math.random(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text || (text[0] !== "{" && text[0] !== "[")) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function writeBlobText(pathname: string, text: string, contentType: string) {
  const blob = await put(pathname, text, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
  return blob.url;
}

async function readBlobText(pathname: string) {
  try {
    const meta = await head(pathname);
    const r = await fetch(meta.url, { cache: "no-store" });
    if (r.ok) return r.text();
  } catch {
    /* list fallback */
  }
  const listed = await list({ prefix: pathname, limit: 1 });
  const hit = listed.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  const r = await fetch(hit.url, { cache: "no-store" });
  if (!r.ok) return null;
  return r.text();
}

export async function listClients(): Promise<ClientRecord[]> {
  if (useBlob()) {
    const listed = await list({ prefix: "clients/", limit: 500 });
    const out: ClientRecord[] = [];
    for (const b of listed.blobs) {
      if (!b.pathname.endsWith(".json")) continue;
      const r = await fetch(b.url, { cache: "no-store" });
      if (r.ok) out.push(await r.json());
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await ensureLocal();
  const dir = path.join(LOCAL_ROOT, "clients");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const out: ClientRecord[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const c = await readJsonLocal<ClientRecord>(`clients/${f}`);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getClient(id: string) {
  if (useBlob()) return readBlobJson<ClientRecord>(`clients/${id}.json`);
  return readJsonLocal<ClientRecord>(`clients/${id}.json`);
}

export async function saveClient(client: ClientRecord) {
  if (useBlob()) await writeBlobJson(`clients/${client.id}.json`, client);
  else await writeJsonLocal(`clients/${client.id}.json`, client);
}

export async function deleteClient(id: string) {
  if (useBlob()) {
    const listed = await list({ prefix: `clients/${id}.json`, limit: 1 });
    for (const b of listed.blobs) await del(b.url);
  } else {
    await fs.unlink(path.join(LOCAL_ROOT, "clients", `${id}.json`)).catch(() => {});
  }
}

export async function listJobs(): Promise<JobRecord[]> {
  if (useBlob()) {
    const listed = await list({ prefix: "jobs/", limit: 500 });
    const out: JobRecord[] = [];
    for (const b of listed.blobs) {
      if (!b.pathname.endsWith(".json")) continue;
      // only top-level jobs/{id}.json mirrors (skip /v/, .locks/, probes)
      const parts = b.pathname.split("/");
      if (parts.length !== 2) continue;
      if (parts[1].includes(".locks")) continue;
      const job = await readJobLatest(parts[1].replace(/\.json$/, ""));
      if (job) out.push(job);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await ensureLocal();
  const dir = path.join(LOCAL_ROOT, "jobs");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const out: JobRecord[] = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f.includes(".lock")) continue;
    const j = await readJsonLocal<JobRecord>(`jobs/${f}`);
    if (j) out.push(j);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Read newest versioned snapshot (unique paths avoid Blob CDN stale overwrites). */
async function readJobLatest(id: string): Promise<JobRecord | null> {
  const listed = await list({ prefix: `jobs/${id}/v/`, limit: 100 });
  const versions = listed.blobs
    .filter((b) => b.pathname.endsWith(".json"))
    .sort((a, b) => b.pathname.localeCompare(a.pathname));
  for (const ver of versions.slice(0, 5)) {
    try {
      const r = await fetch(ver.url + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) continue;
      const job = (await r.json()) as JobRecord;
      if (job?.id) return job;
    } catch {
      /* try older */
    }
  }
  // Legacy fallback: stable path (may be CDN-stale)
  return readBlobJson<JobRecord>(`jobs/${id}.json`);
}

export async function getJob(id: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const job = useBlob() ? await readJobLatest(id) : await readJsonLocal<JobRecord>(`jobs/${id}.json`);
      if (job) return job;
    } catch (e) {
      console.error("getJob attempt", attempt, e);
    }
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return null;
}

export async function saveJob(job: JobRecord) {
  job.updatedAt = new Date().toISOString();
  if (useBlob()) {
    // Unique pathname = immediately readable (overwrite of same key is CDN-cached stale)
    const vid = `${Date.now()}-${nanoid(8)}`;
    const versionPath = `jobs/${job.id}/v/${vid}.json`;
    const payload = JSON.stringify(job);
    await put(versionPath, payload, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
    // Best-effort mirror for directory listing / old readers (may lag — not source of truth)
    try {
      await put(`jobs/${job.id}.json`, payload, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 0,
      });
    } catch {
      /* mirror optional */
    }
    // Prune old versions (keep last ~25)
    try {
      const listed = await list({ prefix: `jobs/${job.id}/v/`, limit: 100 });
      const versions = listed.blobs
        .filter((b) => b.pathname.endsWith(".json"))
        .sort((a, b) => b.pathname.localeCompare(a.pathname));
      for (const old of versions.slice(25)) {
        await del(old.url).catch(() => {});
      }
    } catch {
      /* ignore prune errors */
    }
  } else {
    await writeJsonLocal(`jobs/${job.id}.json`, job);
  }
}

export type JobLockHandle = {
  owner: string;
  until: number;
  at: number;
  pathname: string;
  url: string;
};

type LockPayload = { owner: string; until: number; at: number };

async function listActiveLocks(jobId: string): Promise<(LockPayload & { pathname: string; url: string })[]> {
  const listed = await list({ prefix: `jobs/${jobId}.locks/`, limit: 50 });
  const now = Date.now();
  const out: (LockPayload & { pathname: string; url: string })[] = [];
  for (const b of listed.blobs) {
    if (!b.pathname.endsWith(".json")) continue;
    try {
      const r = await fetch(b.url + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) continue;
      const data = (await r.json()) as LockPayload;
      if (!data?.owner || !data.until || data.until <= now) {
        await del(b.url).catch(() => {});
        continue;
      }
      out.push({ ...data, pathname: b.pathname, url: b.url });
    } catch {
      /* skip */
    }
  }
  // Earliest `at` wins (stable across renewals that keep the same `at`)
  out.sort((a, b) => a.at - b.at || a.pathname.localeCompare(b.pathname));
  return out;
}

/**
 * Exclusive lease via unique lock blobs (earliest active lock wins).
 * Safe under Vercel Blob CDN because paths are never overwritten.
 */
export async function tryAcquireJobLock(jobId: string, ttlMs: number): Promise<JobLockHandle | null> {
  if (!useBlob()) {
    const lockPath = `jobs/${jobId}.lock.json`;
    const existing = await readJsonLocal<LockPayload>(lockPath);
    if (existing && existing.until > Date.now()) return null;
    const owner = nanoid(12);
    const at = Date.now();
    const until = at + ttlMs;
    await writeJsonLocal(lockPath, { owner, until, at });
    await new Promise((r) => setTimeout(r, 50));
    const verify = await readJsonLocal<LockPayload>(lockPath);
    if (!verify || verify.owner !== owner) return null;
    return { owner, until, at, pathname: lockPath, url: lockPath };
  }

  const prior = await listActiveLocks(jobId);
  if (prior.length) return null;

  const owner = nanoid(12);
  const at = Date.now();
  const until = at + ttlMs;
  const pathname = `jobs/${jobId}.locks/${at}-${owner}.json`;
  const blob = await put(pathname, JSON.stringify({ owner, until, at }), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });

  await new Promise((r) => setTimeout(r, 280));
  const active = await listActiveLocks(jobId);
  if (!active.length || active[0].owner !== owner) {
    await del(blob.url).catch(() => {});
    return null;
  }
  return { owner, until, at, pathname, url: blob.url };
}

export async function renewJobLock(handle: JobLockHandle, ttlMs: number): Promise<JobLockHandle | null> {
  const until = Date.now() + ttlMs;
  if (!useBlob()) {
    await writeJsonLocal(handle.pathname, { owner: handle.owner, until, at: handle.at });
    return { ...handle, until };
  }
  // New unique file keeps same `at` so we remain the earliest winner
  const m = handle.pathname.match(/^(jobs\/[^/]+\.locks\/)/);
  const prefix = m?.[1] || `jobs/unknown.locks/`;
  const renewPath = `${prefix}${handle.at}-renew-${nanoid(6)}.json`;
  const blob = await put(renewPath, JSON.stringify({ owner: handle.owner, until, at: handle.at }), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
  await del(handle.url).catch(() => {});
  return { owner: handle.owner, until, at: handle.at, pathname: renewPath, url: blob.url };
}

export async function releaseJobLock(handle: JobLockHandle | null | undefined) {
  if (!handle) return;
  if (!useBlob()) {
    await fs.unlink(path.join(LOCAL_ROOT, handle.pathname)).catch(() => {});
    return;
  }
  await del(handle.url).catch(() => {});
  // also clear any renew siblings for this owner
  try {
    const jobId = handle.pathname.match(/^jobs\/([^/]+)\.locks\//)?.[1];
    if (!jobId) return;
    const listed = await list({ prefix: `jobs/${jobId}.locks/`, limit: 50 });
    for (const b of listed.blobs) {
      try {
        const r = await fetch(b.url, { cache: "no-store" });
        if (!r.ok) continue;
        const data = (await r.json()) as LockPayload;
        if (data.owner === handle.owner) await del(b.url).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export async function hasActiveJobLock(jobId: string): Promise<boolean> {
  if (!useBlob()) {
    const existing = await readJsonLocal<LockPayload>(`jobs/${jobId}.lock.json`);
    return Boolean(existing && existing.until > Date.now());
  }
  const active = await listActiveLocks(jobId);
  return active.length > 0;
}

/** Force-delete all lock blobs for a job (used on cancel). */
export async function clearAllJobLocks(jobId: string) {
  if (!useBlob()) {
    await fs.unlink(path.join(LOCAL_ROOT, "jobs", `${jobId}.lock.json`)).catch(() => {});
    return;
  }
  const listed = await list({ prefix: `jobs/${jobId}.locks/`, limit: 50 });
  for (const b of listed.blobs) {
    await del(b.url).catch(() => {});
  }
}

export async function getJobByPublicToken(token: string) {
  const jobs = await listJobs();
  return jobs.find((j) => j.publicToken === token && j.status === "done") || null;
}

export async function saveReportHtml(
  jobId: string,
  kind: "client" | "internal",
  html: string,
  opts?: { suffix?: string }
) {
  // Unique path when suffix set — avoids Blob CDN serving stale overwrites
  const rel = opts?.suffix
    ? `reports/${jobId}-${kind}-${opts.suffix}.html`
    : `reports/${jobId}-${kind}-${Date.now()}.html`;
  if (useBlob()) {
    const url = await put(rel, html, {
      access: "public",
      addRandomSuffix: false,
      contentType: "text/html; charset=utf-8",
      cacheControlMaxAge: 0,
    }).then((b) => b.url);
    return { path: rel, url };
  }
  await writeTextLocal(rel, html);
  return { path: rel, url: null as string | null };
}

export async function readReportHtml(rel: string) {
  if (useBlob()) return readBlobText(rel);
  return readTextLocal(rel);
}
