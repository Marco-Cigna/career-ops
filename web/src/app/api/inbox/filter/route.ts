import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { cliUnavailableError, resolveCliOrFallback } from "@/lib/clis";
import { runCoreCli } from "@/lib/core-cli";
import { readJsonObject } from "@/lib/json-body";
import { prefetchJd } from "@/lib/jd-prefetch.mjs";
import { postingUrl } from "@/lib/posting-url.mjs";
import { filterPlan } from "@/lib/pipeline-gate.mjs";
import { gateEvaluation, loadPipelineSettings, recordUnchecked, removeClosedPosting } from "@/lib/pipeline-gate-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 400;

// The inbox Filter: steps 1 and 2 of Score (free pre-screen rules, then triage
// on the cheap model) for one posting, with no evaluation after them. A posting
// that fails is ticked off the inbox and logged to data/discard.log, the same
// as a skip in front of Score; every verdict goes to data/inbox-triage.json so
// the inbox can show it and Score does not triage the posting again.
// The client calls this once per posting, a few at a time.

function resolve(cliId: string | null) {
  if (!cliId) return null;
  return resolveCliOrFallback(cliId);
}

/** What a Filter run would do with this CLI: triage model and effort, or why only the rules run. */
export async function GET(req: Request) {
  const resolved = resolve(new URL(req.url).searchParams.get("cliId"));
  if (!resolved) return NextResponse.json({ error: "Choose an AI tool on the Config page first." }, { status: 404 });
  const plan = filterPlan(resolved.spec.id, await loadPipelineSettings());
  return NextResponse.json({ cliId: resolved.spec.id, triage: plan.triage, model: plan.model, effort: plan.effort, reason: plan.reason });
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ url?: unknown; cliId?: unknown }>(req);
  const url = typeof body?.url === "string" ? postingUrl(body.url) : null;
  if (!url) return NextResponse.json({ error: "A posting URL is required." }, { status: 400 });
  const resolved = resolve(typeof body?.cliId === "string" ? body.cliId : null);
  if (!resolved) return NextResponse.json(cliUnavailableError(String(body?.cliId ?? "")), { status: 404 });
  if (!fs.existsSync(careerOpsRoot())) return NextResponse.json({ error: "The data folder is missing." }, { status: 400 });
  const cliId = resolved.spec.id;
  const plan = filterPlan(cliId, await loadPipelineSettings());

  // The posting text, read the free way (ATS API, then the page's own data).
  const prefetch = await prefetchJd(url, runCoreCli, req.signal);
  if (req.signal.aborted) return new Response(null, { status: 499 });
  if (prefetch.closedEvidence) {
    await removeClosedPosting(url, prefetch.closedEvidence);
    return NextResponse.json({ outcome: "removed", stage: "closed", reason: `Posting closed: ${prefetch.closedEvidence}` });
  }

  const gate = await gateEvaluation({ url, jdText: prefetch.text, cliId, binPath: resolved.binPath, settings: plan.settings, signal: req.signal });
  if (req.signal.aborted) return new Response(null, { status: 499 });
  if (gate.skip) {
    return NextResponse.json({ outcome: "removed", stage: gate.stage, reason: gate.reason, score: gate.triage?.score ?? null });
  }
  if (gate.triage) {
    return NextResponse.json({ outcome: "passed", score: gate.triage.score, reason: gate.triage.reason });
  }
  // Rules passed but triage did not run or gave no verdict: kept, and the row says why.
  const why = !plan.triage
    ? "Passed the rules; triage did not run."
    : prefetch.unreadable
      ? `Passed the rules; the posting could not be read (${prefetch.unreadable}).`
      : !prefetch.text
        ? "Passed the rules; the posting text could not be read for triage."
        : "Passed the rules; triage gave no verdict.";
  await recordUnchecked(url, why);
  return NextResponse.json({ outcome: "unchecked", reason: why });
}
