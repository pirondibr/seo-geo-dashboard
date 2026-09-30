import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { isLoggedIn } from "@/lib/auth";
import { listClients, saveClient } from "@/lib/store";
import { normalizeHost } from "@/lib/domain";

export async function GET() {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clients = await listClients();
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const name = String(body.name || "").trim();
  const siteUrl = String(body.siteUrl || "").trim();
  if (!name || !siteUrl) {
    return NextResponse.json({ error: "Nome e site são obrigatórios" }, { status: 400 });
  }
  let hosts: string[] = Array.isArray(body.hosts)
    ? body.hosts.map((h: string) => normalizeHost(h)).filter(Boolean)
    : String(body.hosts || "")
        .split(/[\s,;]+/)
        .map((h: string) => normalizeHost(h))
        .filter(Boolean);
  if (!hosts.length) {
    try {
      hosts = [normalizeHost(siteUrl)];
    } catch {
      hosts = [];
    }
  }
  const client = {
    id: nanoid(10),
    name,
    siteUrl: /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`,
    hosts,
    notes: body.notes ? String(body.notes) : undefined,
    createdAt: new Date().toISOString(),
  };
  await saveClient(client);
  return NextResponse.json({ client });
}
