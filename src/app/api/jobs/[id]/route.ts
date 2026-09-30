import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob } from "@/lib/store";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  // Don't send full response contents in list polling — but detail page needs summary + meta
  return NextResponse.json({
    job: {
      id: job.id,
      clientId: job.clientId,
      clientName: job.clientName,
      siteUrl: job.siteUrl,
      hosts: job.hosts,
      modelKind: job.modelKind,
      modelId: job.modelId,
      status: job.status,
      phase: job.phase,
      label: job.label,
      done: job.done,
      total: job.total,
      costUsd: job.costUsd,
      publicToken: job.publicToken,
      summary: job.summary,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      internalHtmlPath: job.internalHtmlPath,
      clientHtmlPath: job.clientHtmlPath,
      counts: {
        f1: job.resultsFase1?.length || 0,
        f2: job.resultsFase2?.length || 0,
        f3: job.resultsFase3?.length || 0,
        f1Hit: job.resultsFase1?.filter((r) => r.site).length || 0,
        f2Hit: job.resultsFase2?.filter((r) => r.site).length || 0,
        f3Hit: job.resultsFase3?.filter((r) => r.site).length || 0,
      },
    },
  });
}
