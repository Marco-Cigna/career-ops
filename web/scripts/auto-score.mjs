#!/usr/bin/env node
/**
 * auto-score.mjs — work through the inbox without anyone watching.
 *
 * Asks the running dashboard for the pending postings and sends them, one at a
 * time, down the same path "Score shortlist" uses: prescreen rules, triage on
 * the economy model, then the full evaluation on the spend-tier model. A score
 * at or above the PDF threshold also gets its tailored CV. Nothing is ever
 * applied to or submitted.
 *
 *   node web/scripts/auto-score.mjs [--limit N] [--max-evals N] [--pdf-min S]
 *                                   [--cli ID] [--url BASE] [--dry-run]
 *
 *   --limit      postings to look at this run (default 15)
 *   --max-evals  full evaluations this run; gate skips do not count (default 5)
 *   --pdf-min    score from which a tailored CV is generated (default 4.0, 0 = never)
 *   --cli        agent CLI id (default claude)
 *   --dry-run    list what would run, spend nothing
 *
 * It stops early after three failures in a row, which is what a rate limit or
 * a signed-out CLI looks like. Exit 0 when the run finished, 1 when it could
 * not start or stopped early.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../../lib/is-main-module.mjs";
import { getCareerOpsRoot } from "../../path-resolver.mjs";

const USAGE = "Usage: node web/scripts/auto-score.mjs [--limit N] [--max-evals N] [--pdf-min S] [--cli ID] [--url BASE] [--dry-run]";

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { limit: 15, maxEvals: 5, pdfMin: 4.0, cli: "claude", url: "http://127.0.0.1:3000", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
      i += 1;
      return v;
    };
    const number = (min) => {
      const n = Number(value());
      if (!Number.isFinite(n) || n < min) throw new Error(`${flag} must be a number of at least ${min}`);
      return n;
    };
    if (flag === "--dry-run") opts.dryRun = true;
    else if (flag === "--limit") opts.limit = Math.floor(number(1));
    else if (flag === "--max-evals") opts.maxEvals = Math.floor(number(1));
    else if (flag === "--pdf-min") opts.pdfMin = number(0);
    else if (flag === "--cli") opts.cli = value();
    else if (flag === "--url") opts.url = value().replace(/\/+$/, "");
    else throw new Error(`unknown flag ${flag}`);
  }
  return opts;
}

/** Newest posting first; postings with no date after the dated ones, in inbox order. */
export function orderInbox(inbox) {
  const time = (job) => {
    const t = Date.parse(job?.postedAt ?? "");
    return Number.isFinite(t) ? t : -Infinity;
  };
  return (Array.isArray(inbox) ? inbox : [])
    .filter((job) => typeof job?.url === "string" && /^https?:\/\//i.test(job.url))
    .map((job, index) => ({ job, index }))
    .sort((a, b) => time(b.job) - time(a.job) || a.index - b.index)
    .map(({ job }) => job);
}

/** Read one /api/run NDJSON body down to its outcome. */
export function readRun(body) {
  let text = "";
  /** @type {{status: "done"|"gated"|"error", message?: string, reportN?: number, tokens?: number}} */
  let outcome = { status: "error", message: "The server closed the run without an outcome." };
  for (const line of String(body ?? "").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "text" && typeof event.text === "string") text += event.text;
    else if (event.type === "done") outcome = { status: "done", reportN: event.reportN, tokens: event.tokens };
    else if (event.type === "gated") outcome = { status: "gated", message: event.message };
    else if (event.type === "error") outcome = { status: "error", message: event.msg };
  }
  const verdict = text.match(/VERDICT:\s*(\d+(?:\.\d+)?)\s*\/\s*5/i);
  return { ...outcome, score: verdict ? Number(verdict[1]) : null };
}

async function post(base, body) {
  const res = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = JSON.parse(text).error || message; } catch { /* keep the status */ }
    return { status: /** @type {const} */ ("error"), message, score: null };
  }
  return readRun(text);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`auto-score: ${err.message}\n${USAGE}`);
    return 1;
  }
  const root = getCareerOpsRoot();
  const logFile = path.join(root, "data", "auto-score.log");
  const log = (line) => {
    const stamped = `${new Date().toISOString()}\t${line}`;
    console.log(stamped);
    if (opts.dryRun) return;
    try {
      mkdirSync(path.dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${stamped}\n`);
    } catch { /* the console line still stands */ }
  };

  let inbox;
  try {
    const res = await fetch(`${opts.url}/api/pipeline`, { headers: { Origin: opts.url } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    inbox = orderInbox((await res.json()).inbox);
  } catch (err) {
    console.error(`auto-score: the dashboard is not answering at ${opts.url} (${err.message}). Start it with: node web/scripts/web-service.mjs install`);
    return 1;
  }
  const batch = inbox.slice(0, opts.limit);
  log(`start\tpending=${inbox.length}\tthis-run=${batch.length}\tmax-evals=${opts.maxEvals}${opts.dryRun ? "\tdry-run" : ""}`);
  if (opts.dryRun) {
    for (const job of batch) console.log(`  would score: ${job.company ?? "?"} — ${job.role ?? job.title ?? "?"} (${job.postedAt ?? "no date"})\n    ${job.url}`);
    return 0;
  }

  let evaluated = 0;
  let skipped = 0;
  let failedInRow = 0;
  let stoppedEarly = false;
  for (const job of batch) {
    if (evaluated >= opts.maxEvals) break;
    const label = `${job.company ?? "?"} — ${job.role ?? job.title ?? "?"}`;
    let run;
    try {
      run = await post(opts.url, { kind: "evaluate", input: job.url, cliId: opts.cli, gate: true });
    } catch (err) {
      run = { status: "error", message: err.message, score: null };
    }
    if (run.status === "gated") {
      skipped += 1;
      failedInRow = 0;
      log(`skipped\t${label}\t${job.url}\t${run.message ?? ""}`);
      continue;
    }
    if (run.status === "error") {
      failedInRow += 1;
      log(`failed\t${label}\t${job.url}\t${run.message ?? ""}`);
      if (failedInRow >= 3) {
        stoppedEarly = true;
        log("stopped\tthree failures in a row (rate limit, or the CLI is signed out)");
        break;
      }
      continue;
    }
    evaluated += 1;
    failedInRow = 0;
    log(`scored\t${label}\t${job.url}\treport=${run.reportN ?? "?"}\tscore=${run.score ?? "?"}\ttokens=${run.tokens ?? "?"}`);
    if (opts.pdfMin > 0 && typeof run.reportN === "number" && run.score !== null && run.score >= opts.pdfMin) {
      const pdf = await post(opts.url, { kind: "pdf", input: String(run.reportN), cliId: opts.cli }).catch((err) => ({ status: "error", message: err.message }));
      log(`cv\t${label}\treport=${run.reportN}\t${pdf.status === "done" ? "generated" : `failed: ${pdf.message ?? ""}`}`);
    }
  }
  log(`end\tscored=${evaluated}\tskipped=${skipped}\tleft=${Math.max(0, inbox.length - evaluated - skipped)}`);
  return stoppedEarly ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`auto-score: ${err?.message || err}`);
    process.exit(1);
  });
}

// Kept for callers that resolve this script by path (the scheduler).
export const AUTO_SCORE_SCRIPT = fileURLToPath(import.meta.url);
