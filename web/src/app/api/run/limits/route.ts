import { NextResponse } from "next/server";
import { loadPipelineSettings } from "@/lib/pipeline-gate-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How many queued evaluations the dashboard may run at once: pipeline.parallel
// in config/profile.yml, the same key batch-runner.sh reads. One when unset: a
// queue the user did not size should not fan out.
export async function GET() {
  const settings = await loadPipelineSettings();
  return NextResponse.json({ parallel: settings?.parallel ?? 1, spendTier: settings?.spendTier ?? null });
}
