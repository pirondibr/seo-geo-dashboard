import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, saveJob } from "@/lib/store";
import { pushLog, scheduleTick } from "@/lib/job-runner";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (job.status === "done") {
    return NextResponse.json({ ok: true, message: "Job já concluído" });
  }
  if (job.status === "error") {
    // retry from last non-error phase when possible — if phase is error, go back to generate_fase1 if we have siteBrief
    if (job.siteBrief && (!job.promptsFase1 || job.promptsFase1.length < 40)) {
      job.phase = "generate_fase1";
      job.fase1GenStep = job.promptsFase1?.length ? Math.min(2, Math.floor((job.promptsFase1.length || 0) / 20)) : 0;
    } else if (job.promptsFase1 && job.promptsFase1.length >= 40 && (job.resultsFase1?.length || 0) < job.promptsFase1.length) {
      job.phase = "fase1";
      job.cursor = job.resultsFase1?.length || 0;
    } else {
      job.phase = job.phase === "error" ? "queued" : job.phase;
    }
    job.status = "queued";
    job.error = undefined;
    job.label = "Retomando…";
  }
  job.lockedUntil = undefined;
  if (job.status === "running") {
    job.status = "queued"; // allow worker to pick up again
  }
  pushLog(job, "Retomar solicitado pela agência · agendando worker…");
  await saveJob(job);
  await scheduleTick(id);
  return NextResponse.json({ ok: true });
}
