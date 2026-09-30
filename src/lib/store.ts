import { put, list, del } from "@vercel/blob";
import fs from "fs/promises";
import path from "path";
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
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function readBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    const listed = await list({ prefix: pathname, limit: 5 });
    const hit = listed.blobs.find((b) => b.pathname === pathname);
    if (!hit) return null;
    const r = await fetch(hit.url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
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
      if (!b.pathname.endsWith(".json") || b.pathname.includes("/results/")) continue;
      const parts = b.pathname.split("/");
      if (parts.length !== 2) continue;
      const r = await fetch(b.url, { cache: "no-store" });
      if (r.ok) out.push(await r.json());
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await ensureLocal();
  const dir = path.join(LOCAL_ROOT, "jobs");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const out: JobRecord[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const j = await readJsonLocal<JobRecord>(`jobs/${f}`);
    if (j) out.push(j);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJob(id: string) {
  if (useBlob()) return readBlobJson<JobRecord>(`jobs/${id}.json`);
  return readJsonLocal<JobRecord>(`jobs/${id}.json`);
}

export async function saveJob(job: JobRecord) {
  job.updatedAt = new Date().toISOString();
  if (useBlob()) await writeBlobJson(`jobs/${job.id}.json`, job);
  else await writeJsonLocal(`jobs/${job.id}.json`, job);
}

export async function getJobByPublicToken(token: string) {
  const jobs = await listJobs();
  return jobs.find((j) => j.publicToken === token && j.status === "done") || null;
}

export async function saveReportHtml(jobId: string, kind: "client" | "internal", html: string) {
  const rel = `reports/${jobId}-${kind}.html`;
  if (useBlob()) {
    const url = await writeBlobText(rel, html, "text/html; charset=utf-8");
    return { path: rel, url };
  }
  await writeTextLocal(rel, html);
  return { path: rel, url: null as string | null };
}

export async function readReportHtml(rel: string) {
  if (useBlob()) return readBlobText(rel);
  return readTextLocal(rel);
}
