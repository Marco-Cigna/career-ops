import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { runCoreCli, runSetStatus } from "@/lib/core-cli";
import { acquireTrackerWrite, isTrackerWriting, releaseTrackerWrite } from "@/lib/core/run-registry";
import { readJsonObject } from "@/lib/json-body";
import { appliedNote, appliedTsv, cleanField, cleanUrl, companySlug, localDate, validateSave } from "@/lib/external-applied.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Add applied job" on the Pipeline page: record an application the user sent
// on their own. No model is called anywhere here.
//   {step: "preview", url}  optional: read company and role from the link
//     (posting-meta.mjs, a plain scrape) to prefill the form, and list tracker
//     rows that may be the same opening;
//   {step: "save", url, company, role, city?, force?}  the user's own
//     values. Possible duplicates are returned instead of saving unless
//     `force` is set. Otherwise the row goes in through the tracker-addition
//     TSV + merge-tracker.mjs, then set-status.mjs moves it to Applied so the
//     ledger and follow-up seeding see the transition. Dated today, score N/A,
//     no report.

type Meta = { ok: boolean; url?: string; company?: string; role?: string; location?: string; city?: string; source?: string; linkedin?: boolean; error?: string };
type Candidate = { num: string; company: string; role: string; status: string; date: string; reason: string };

function readPostingMeta(input: { url: string; text?: string }, signal: AbortSignal): Promise<Meta> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      // windowsHide: see api/doctor/route.ts.
      child = spawn(process.execPath, [rootScript("posting-meta")], { cwd: resolveCodeRoot(process.cwd(), process.env), env: process.env, windowsHide: true });
    } catch {
      resolve({ ok: false, error: "Could not read the link." });
      return;
    }
    const kill = () => { try { child.kill("SIGTERM"); } catch { /* ignore */ } };
    const timer = setTimeout(kill, 40_000);
    signal.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, error: "Could not read the link." }); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() || "") as Meta);
      } catch {
        resolve({ ok: false, error: "Could not read the link." });
      }
    });
    child.stdin.on("error", () => { /* closed early: the close handler answers */ });
    child.stdin.end(JSON.stringify(input));
  });
}

async function duplicates(company: string, role: string, url: string): Promise<Candidate[]> {
  // The link alone is enough to find a row it already belongs to.
  const args = [...(company ? ["--company", company] : []), ...(role ? ["--title", role] : []), "--url", url, "--json"];
  const run = await runCoreCli("precheck-duplicate", args);
  if (run.code !== 0) return [];
  try {
    const parsed = JSON.parse(run.stdout) as { candidates?: Candidate[] };
    return (parsed.candidates ?? []).slice(0, 5).map((c) => ({ num: String(c.num), company: c.company, role: c.role, status: c.status, date: c.date, reason: c.reason }));
  } catch {
    return [];
  }
}

async function preview(body: { url?: unknown }, signal: AbortSignal) {
  const url = cleanUrl(body.url);
  if (!url) return Response.json({ error: "Paste a full job link that starts with https://." }, { status: 400 });
  if (!fs.existsSync(rootScript("posting-meta"))) {
    return Response.json({ error: "This needs a newer career-ops checkout (posting-meta.mjs)." }, { status: 503 });
  }
  const meta = await readPostingMeta({ url }, signal);
  if (!meta.ok) return Response.json({ error: meta.error || "Could not read the link." }, { status: 400 });
  const company = cleanField(meta.company);
  const role = cleanField(meta.role);
  const postingUrl = meta.url || url;
  return Response.json({
    url: postingUrl,
    company,
    role,
    city: cleanField(meta.city),
    source: meta.source || "none",
    linkedin: meta.linkedin === true,
    duplicates: await duplicates(company, role, postingUrl),
  });
}

async function landedAsNewRow(num: string, company: string): Promise<boolean> {
  const run = await runCoreCli("tracker", ["query", "--id", String(Number(num)), "--json"]);
  if (run.code !== 0) return false;
  try {
    const rows = JSON.parse(run.stdout.slice(run.stdout.indexOf("["))) as { company?: string; status?: string }[];
    const row = rows[0];
    return !!row && String(row.company).trim().toLowerCase() === company.toLowerCase() && row.status === "Evaluated";
  } catch {
    return false;
  }
}

async function save(body: Record<string, unknown>) {
  const fields = validateSave(body);
  if (!fields.ok) return Response.json({ error: fields.error }, { status: 400 });
  // Typed by hand, the form may never have checked the tracker: check here,
  // and save a possible duplicate only when the user says to.
  if (body.force !== true) {
    const found = await duplicates(fields.company, fields.role, fields.url);
    if (found.length) return Response.json({ duplicates: found }, { status: 409 });
  }
  if (isTrackerWriting()) {
    return Response.json({ error: "Your tracker is being updated right now. Try again in a moment." }, { status: 409 });
  }
  const token = acquireTrackerWrite();
  let num = "";
  try {
    const reserved = await runCoreCli("reserve-report-num", []);
    num = reserved.stdout.trim();
    if (reserved.code !== 0 || !/^\d{3,}$/.test(num)) {
      num = "";
      return Response.json({ error: "Could not reserve a tracker number. Nothing was saved." }, { status: 500 });
    }
    const date = localDate();
    const additions = path.join(careerOpsRoot(), "batch", "tracker-additions");
    const file = path.join(additions, `${num}-${companySlug(fields.company)}.tsv`);
    if (path.dirname(file) !== additions) return Response.json({ error: "Refusing to write outside batch/tracker-additions." }, { status: 400 });
    fs.mkdirSync(additions, { recursive: true });
    fs.writeFileSync(file, appliedTsv({ num, date, company: fields.company, role: fields.role, city: fields.city, notes: appliedNote(fields), url: fields.url }));

    const merged = await runCoreCli("merge-tracker", []);
    if (merged.code !== 0) {
      console.error(`/api/tracker/add-applied: merge-tracker failed: ${merged.stderr.trim()}`);
      return Response.json({ error: "Saving to the tracker failed. Check Tools → Merge tracker additions." }, { status: 500 });
    }
    // merge-tracker folds an addition into a row it judges to be the same
    // opening instead of adding one. Only a row that landed under our own number
    // with our company is ours to mark Applied.
    if (!(await landedAsNewRow(num, fields.company))) {
      return Response.json({
        error: "This matched a row already in your tracker, so no new row was added. Find it in the table and set its status to Applied.",
      }, { status: 409 });
    }
    const status = await runSetStatus(["--row", String(Number(num)), "Applied", "--source", "web", "--json"]);
    if (status.code !== 0) {
      console.error(`/api/tracker/add-applied: set-status failed: ${status.stderr.trim() || status.stdout.trim()}`);
      return Response.json({ ok: true, num: String(Number(num)), date, warning: `Added as #${Number(num)}, but it could not be marked Applied. Set its status from the table.` });
    }
    return Response.json({ ok: true, num: String(Number(num)), date });
  } finally {
    releaseTrackerWrite(token);
    if (num) await runCoreCli("reserve-report-num", ["--release", num]);
  }
}

export async function POST(req: Request) {
  const body = await readJsonObject<Record<string, unknown>>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  if (body.step === "preview") return preview(body, req.signal);
  if (body.step === "save") return save(body);
  return Response.json({ error: "step must be preview or save" }, { status: 400 });
}
