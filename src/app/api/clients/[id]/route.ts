import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { deleteClient, getClient, saveClient } from "@/lib/store";
import { normalizeHost } from "@/lib/domain";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  return NextResponse.json({ client });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const body = await req.json();
  if (body.name) client.name = String(body.name).trim();
  if (body.siteUrl) {
    const u = String(body.siteUrl).trim();
    client.siteUrl = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  }
  if (body.hosts != null) {
    client.hosts = Array.isArray(body.hosts)
      ? body.hosts.map((h: string) => normalizeHost(h)).filter(Boolean)
      : String(body.hosts)
          .split(/[\s,;]+/)
          .map((h: string) => normalizeHost(h))
          .filter(Boolean);
  }
  await saveClient(client);
  return NextResponse.json({ client });
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await deleteClient(id);
  return NextResponse.json({ ok: true });
}
