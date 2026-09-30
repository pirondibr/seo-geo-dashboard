import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, getJobByPublicToken, readReportHtml } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const kind = req.nextUrl.searchParams.get("kind") || "client";

  if (kind === "internal") {
    if (!(await isLoggedIn())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const job = await getJob(token);
    if (!job?.internalHtmlPath) return NextResponse.json({ error: "Relatório interno ainda não pronto" }, { status: 404 });
    const html = await readReportHtml(job.internalHtmlPath);
    if (!html) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  // public client report by publicToken
  const job = await getJobByPublicToken(token);
  if (!job?.clientHtmlPath) {
    // also allow agency to open by job id if logged in
    if (await isLoggedIn()) {
      const byId = await getJob(token);
      if (byId?.clientHtmlPath) {
        const html = await readReportHtml(byId.clientHtmlPath);
        if (html) {
          return new NextResponse(html, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
          });
        }
      }
    }
    return NextResponse.json({ error: "Relatório não encontrado" }, { status: 404 });
  }
  const html = await readReportHtml(job.clientHtmlPath);
  if (!html) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
