import fs from "node:fs";
import { NextResponse } from "next/server";
import { rootScript } from "@/lib/career-ops";
import { runCoreScriptLong } from "@/lib/core-script-long";
import { isTrackerWriting } from "@/lib/core/run-registry";
import { readJsonObject } from "@/lib/json-body";
import { plainOutput, scriptTool } from "@/lib/tools-catalog.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Runs one core script from the closed catalog. The request names an id only:
// the script and its arguments come from tools-catalog.mjs, never from the body.
export async function POST(req: Request) {
  const body = await readJsonObject<{ id?: unknown }>(req);
  const tool = scriptTool(body?.id);
  if (!tool) return NextResponse.json({ error: "Unknown tool." }, { status: 400 });
  const script = rootScript(tool.script);
  if (!fs.existsSync(script)) {
    return NextResponse.json({ error: `This needs a complete career-ops checkout (${tool.script}.mjs).` }, { status: 503 });
  }
  // A tracker rewrite must not race an evaluation that is about to merge its row.
  if (tool.writes && isTrackerWriting()) {
    return NextResponse.json({ error: "An evaluation or CV run is writing to the tracker. Try again when it finishes." }, { status: 409 });
  }
  const run = await runCoreScriptLong(tool.script, tool.args, tool.slow ? 540_000 : 120_000);
  const result = { code: run.code, output: plainOutput([run.stdout, run.stderr].filter(Boolean).join("\n")), timedOut: run.timedOut };
  return NextResponse.json({ id: tool.id, ...result });
}
