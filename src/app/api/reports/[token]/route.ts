import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getJob, getJobByPublicToken, readReportHtml } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const kind = req.nextUrl.searchParams.get("kind") || "client";

    if (kind === "internal") {
      if (!(await isLoggedIn())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const job = await getJob(token);
      if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

      const phase = req.nextUrl.searchParams.get("phase"); // fase1 | fase2 | fase3 | (latest)
      let path = job.internalHtmlPath;
      if (phase === "fase1" || phase === "fase2" || phase === "fase3") {
        path = job.phaseReports?.[phase] || path;
      }
      if (!path) return NextResponse.json({ error: "Relatório interno ainda não pronto" }, { status: 404 });
      const html = await readReportHtml(path);
      if (!html) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
      });
    }

    // public client report by publicToken
    const job = await getJobByPublicToken(token);
    if (!job?.clientHtmlPath) {
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
  } catch (e) {
    console.error("reports GET", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao abrir relatório" },
      { status: 500 }
    );
  }
}
