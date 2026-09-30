import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { deleteClient, getClient, saveClient, listJobs, getLatestAiOverviewForClient } from "@/lib/store";
import { normalizeHost } from "@/lib/domain";

function slimJob(j: Awaited<ReturnType<typeof listJobs>>[number]) {
  return {
    id: j.id,
    clientId: j.clientId,
    modelKind: j.modelKind,
    status: j.status,
    phase: j.phase,
    label: j.label,
    costUsd: j.costUsd,
    publicToken: j.publicToken,
    summary: j.summary,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    startedAt: j.startedAt,
    internalHtmlPath: j.internalHtmlPath || null,
    clientHtmlPath: j.clientHtmlPath || null,
    phaseReports: j.phaseReports || {},
  };
}

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const all = (await listJobs()).filter((j) => j.clientId === id);
  all.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  // Latest job per model (ChatGPT and Gemini independently)
  const byKind = new Map<string, (typeof all)[0]>();
  for (const j of all) {
    if (j.modelKind !== "gpt" && j.modelKind !== "gemini") continue;
    if (!byKind.has(j.modelKind)) byKind.set(j.modelKind, j);
  }
  const latestJobs = ["gpt", "gemini"]
    .map((k) => byKind.get(k))
    .filter(Boolean)
    .map((j) => slimJob(j!));
  const latestRunAt = latestJobs.length
    ? latestJobs
        .map((j) => j.startedAt || j.createdAt)
        .sort((a, b) => String(b).localeCompare(String(a)))[0]
    : null;

  const latestAi = await getLatestAiOverviewForClient(id);

  return NextResponse.json({
    client,
    latestRunAt,
    latestJobs,
    latestAiOverview: latestAi
      ? {
          id: latestAi.id,
          publicToken: latestAi.publicToken,
          keywordCount: latestAi.keywordCount,
          sourceFileName: latestAi.sourceFileName,
          createdAt: latestAi.createdAt,
          htmlPath: latestAi.htmlPath || null,
        }
      : null,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const body = await req.json();
  if (body.name) client.name = String(body.name).trim();
  if (body.siteUrl) {
    const u = String(body.siteUrl).trim();
    client.siteUrl = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  }
  if (body.hosts != null) {
    client.hosts = Array.isArray(body.hosts)
      ? body.hosts.map((h: string) => normalizeHost(h)).filter(Boolean)
      : String(body.hosts)
          .split(/[\s,;]+/)
          .map((h: string) => normalizeHost(h))
          .filter(Boolean);
  }
  await saveClient(client);
  return NextResponse.json({ client });
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await deleteClient(id);
  return NextResponse.json({ ok: true });
}
