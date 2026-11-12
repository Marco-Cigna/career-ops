import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { localToolsConfigPath, readLocalTools, readRuns, startLocalTool } from "@/lib/local-tools-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The user's own scripts (config/local-tools.yml). GET lists them with their
// last run; POST {id} starts one in the background and the page polls GET.
export async function GET() {
  const { tools, problems, exists } = readLocalTools();
  const runs = readRuns();
  return NextResponse.json({
    configExists: exists,
    configPath: localToolsConfigPath(),
    problems,
    tools: tools.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      staleAfterHours: t.staleAfterHours,
      lastRun: runs[t.id] ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ id?: unknown }>(req);
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
  const refused = startLocalTool(body.id);
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 202 });
}
