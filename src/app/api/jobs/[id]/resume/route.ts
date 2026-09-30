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
    job.status = "queued";
    job.phase = job.phase === "error" ? "queued" : job.phase;
    job.error = undefined;
    job.label = "Retomando…";
  }
  pushLog(job, "Retomar solicitado pela agência · agendando worker…");
  await saveJob(job);
  await scheduleTick(id);
  return NextResponse.json({ ok: true });
}
