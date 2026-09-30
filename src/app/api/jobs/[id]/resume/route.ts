import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, saveJob } from "@/lib/store";
import { pushLog, scheduleTick } from "@/lib/job-runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function recoverPhase(job: {
  siteBrief?: string;
  promptsFase1?: unknown[];
  promptsFase2?: unknown[] | undefined;
  promptsFase3?: unknown[] | undefined;
  resultsFase1?: unknown[];
  resultsFase2?: unknown[];
  resultsFase3?: unknown[];
  phase: string;
  fase1GenStep?: number;
}) {
  const p1 = job.promptsFase1?.length || 0;
  const p2 = job.promptsFase2?.length || 0;
  const p3 = job.promptsFase3?.length || 0;
  const r1 = job.resultsFase1?.length || 0;
  const r2 = job.resultsFase2?.length || 0;
  const r3 = job.resultsFase3?.length || 0;
  const genStep = job.fase1GenStep || 0;

  if (!job.siteBrief) return "queued";
  if (genStep < 3 || p1 < 40) return "generate_fase1";
  if (r1 < p1) return "fase1";
  // undefined = ainda não gerou; [] = pulou de propósito (sem seeds)
  if (job.promptsFase2 === undefined) return "generate_fase2";
  if (p2 > 0 && r2 < p2) return "fase2";
  if (job.promptsFase3 === undefined) return "generate_fase3";
  if (p3 > 0 && r3 < p3) return "fase3";
  return "build_reports";
}

export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (job.status === "done") {
    return NextResponse.json({ ok: true, message: "Job já concluído", status: "done", phase: job.phase });
  }

  // Never clear an active lease — that was causing overlapping OpenRouter spend
  const locked =
    job.lockOwner && job.lockedUntil && new Date(job.lockedUntil).getTime() > Date.now();
  if (locked) {
    return NextResponse.json({
      ok: true,
      busy: true,
      status: job.status,
      phase: job.phase,
      label: job.label,
      done: job.done,
      total: job.total,
    });
  }

  if (job.status === "error" || job.phase === "error") {
    job.phase = recoverPhase(job) as typeof job.phase;
    job.error = undefined;
    job.status = "running";
    job.lockOwner = undefined;
    job.lockedUntil = undefined;
    job.claim = undefined;
    pushLog(job, `Recuperando do erro → fase ${job.phase}`);
    if (job.phase === "fase1") job.cursor = job.resultsFase1?.length || 0;
    if (job.phase === "fase2") job.cursor = job.resultsFase2?.length || 0;
    if (job.phase === "fase3") job.cursor = job.resultsFase3?.length || 0;
    await saveJob(job);
  } else if (job.status === "queued") {
    pushLog(job, "Retomar: agendando worker…");
    await saveJob(job);
  }

  // Single entry: schedule one tick. runTick acquires the lease; no inline + schedule double-fire.
  await scheduleTick(id);

  job = (await getJob(id)) || job;
  return NextResponse.json({
    ok: true,
    status: job.status,
    phase: job.phase,
    label: job.label,
    done: job.done,
    total: job.total,
    busy: Boolean(job.lockOwner && job.lockedUntil && new Date(job.lockedUntil).getTime() > Date.now()),
  });
}
