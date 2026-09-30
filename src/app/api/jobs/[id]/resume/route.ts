import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, saveJob } from "@/lib/store";
import { pushLog, runTick, scheduleTick } from "@/lib/job-runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

  if (job.status === "error") {
    if (job.siteBrief && (!job.promptsFase1 || job.promptsFase1.length < 40)) {
      job.phase = "generate_fase1";
      job.fase1GenStep = job.promptsFase1?.length
        ? Math.min(2, Math.floor((job.promptsFase1.length || 0) / 20))
        : 0;
    } else if (
      job.promptsFase1 &&
      job.promptsFase1.length >= 40 &&
      (job.resultsFase1?.length || 0) < job.promptsFase1.length
    ) {
      job.phase = "fase1";
      job.cursor = job.resultsFase1?.length || 0;
    } else if (job.phase === "error") {
      job.phase = "queued";
    }
    job.error = undefined;
  }

  // Sync cursor from results before running
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
