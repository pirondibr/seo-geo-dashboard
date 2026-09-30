import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, saveJob, clearAllJobLocks } from "@/lib/store";
import { pushLog, buildInternalSnapshotOnCancel } from "@/lib/job-runner";

export const dynamic = "force-dynamic";

export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  if (job.status === "done") {
    return NextResponse.json({ ok: true, message: "Já concluído", status: "done" });
  }
  if (job.status === "cancelled") {
    return NextResponse.json({ ok: true, message: "Já parado", status: "cancelled" });
  }

  job.status = "cancelled";
  job.phase = "error";
  job.label = "Parado pela agência";
  job.error = "Cancelado manualmente";
  job.lockOwner = undefined;
  job.lockedUntil = undefined;
  job.claim = undefined;
  pushLog(job, "Job parado pela agência — nenhuma nova chamada à API será feita", "warn");

  try {
    await buildInternalSnapshotOnCancel(job);
  } catch (e) {
    pushLog(job, `Snapshot ao parar falhou: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }

  await saveJob(job);
  await clearAllJobLocks(id).catch(() => {});

  return NextResponse.json({
    ok: true,
    status: job.status,
    phaseReports: job.phaseReports || {},
    internalHtmlPath: job.internalHtmlPath,
  });
}
