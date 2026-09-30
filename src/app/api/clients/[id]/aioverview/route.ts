import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getClient } from "@/lib/store";
import { createAiOverviewFromUpload } from "@/lib/cross-link";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .xlsx ou .csv do Semrush" }, { status: 400 });
  }
  const name = file.name || "semrush.xlsx";
  if (!/\.(xlsx|xls|csv)$/i.test(name)) {
    return NextResponse.json({ error: "Formato inválido. Use .xlsx ou .csv" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "Arquivo muito grande (máx. 15 MB)" }, { status: 400 });
  }

  try {
    const rec = await createAiOverviewFromUpload({
      clientId: client.id,
      clientName: client.name,
      siteUrl: client.siteUrl,
      fileName: name,
      fileBuf: buf,
    });
    if (!rec) return NextResponse.json({ error: "Falha ao gerar relatório" }, { status: 500 });
    return NextResponse.json({
      ok: true,
      report: {
        id: rec.id,
        publicToken: rec.publicToken,
        keywordCount: rec.keywordCount,
        sourceFileName: rec.sourceFileName,
        createdAt: rec.createdAt,
        htmlPath: rec.htmlPath,
        clientUrl: `/r/${rec.publicToken}`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao processar arquivo" },
      { status: 400 }
    );
  }
}
