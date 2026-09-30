import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/job-runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = process.env.JOB_SECRET || process.env.AUTH_SECRET || "dev-secret";
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const job = await runTick(id);
  return NextResponse.json({
    id: job.id,
    status: job.status,
    phase: job.phase,
    label: job.label,
    done: job.done,
    total: job.total,
  });
}
