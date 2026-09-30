import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getClient, listJobs } from "@/lib/store";
import { createJobsForClient, scheduleTick } from "@/lib/job-runner";

export async function GET() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobs = await listJobs();
  const slim = jobs.map((j) => ({
    id: j.id,
    clientId: j.clientId,
    clientName: j.clientName,
    modelKind: j.modelKind,
    status: j.status,
    phase: j.phase,
    label: j.label,
    done: j.done,
    total: j.total,
    costUsd: j.costUsd,
    publicToken: j.publicToken,
    summary: j.summary,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    startedAt: j.startedAt,
    internalHtmlPath: j.internalHtmlPath || null,
    clientHtmlPath: j.clientHtmlPath || null,
    error: j.error,
  }));
  return NextResponse.json({ jobs: slim });
}

export async function POST(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const clientId = String(body.clientId || "");
  const choice = body.choice as "gpt" | "gemini" | "both";
  if (!clientId || !["gpt", "gemini", "both"].includes(choice)) {
    return NextResponse.json({ error: "clientId e choice (gpt|gemini|both) obrigatórios" }, { status: 400 });
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  try {
    // fail fast if key missing
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY não configurada no servidor" }, { status: 500 });
    }
  } catch {
    /* */
  }

  const jobs = await createJobsForClient({
    clientId: client.id,
    clientName: client.name,
    siteUrl: client.siteUrl,
    hosts: client.hosts,
    choice,
  });

  for (const job of jobs) {
    const { getJob, saveJob } = await import("@/lib/store");
    const { pushLog } = await import("@/lib/job-runner");
    const fresh = await getJob(job.id);
    if (fresh) {
      pushLog(fresh, "Agendando worker…");
      await saveJob(fresh);
    }
    await scheduleTick(job.id);
  }

  return NextResponse.json({
    jobs: jobs.map((j) => ({ id: j.id, modelKind: j.modelKind, publicToken: j.publicToken })),
  });
}
