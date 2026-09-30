import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, saveJob } from "@/lib/store";
import { pushLog, runTick, scheduleTick } from "@/lib/job-runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function recoverPhase(job: {
  siteBrief?: string;
  promptsFase1?: unknown[];
  promptsFase2?: unknown[];
  promptsFase3?: unknown[];
  resultsFase1?: unknown[];
  resultsFase2?: unknown[];
  resultsFase3?: unknown[];
  phase: string;
}) {
  const p1 = job.promptsFase1?.length || 0;
  const p2 = job.promptsFase2?.length || 0;
  const p3 = job.promptsFase3?.length || 0;
  const r1 = job.resultsFase1?.length || 0;
  const r2 = job.resultsFase2?.length || 0;
  const r3 = job.resultsFase3?.length || 0;

  if (!job.siteBrief) return "queued";
  if (p1 < 40) return "generate_fase1";
  if (r1 < p1) return "fase1";
  if (p2 < 1) return "generate_fase2";
  if (r2 < p2) return "fase2";
  if (p3 < 1) return "generate_fase3";
  if (r3 < p3) return "fase3";
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

  if (job.lockedUntil && new Date(job.lockedUntil).getTime() > Date.now()) {
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
    pushLog(job, `Recuperando do erro → fase ${job.phase}`);
  }

  if (job.phase === "fase1") job.cursor = job.resultsFase1?.length || 0;
  if (job.phase === "fase2") job.cursor = job.resultsFase2?.length || 0;
  if (job.phase === "fase3") job.cursor = job.resultsFase3?.length || 0;

  job.lockedUntil = undefined;
  job.status = "running";
  pushLog(job, "Retomar: executando worker agora…");
  await saveJob(job);

  const after = await runTick(id);
  if (after.status !== "done" && after.status !== "error") {
    void scheduleTick(id);
  }

  return NextResponse.json({
    ok: true,
    status: after.status,
    phase: after.phase,
    label: after.label,
    done: after.done,
    total: after.total,
  });
}
