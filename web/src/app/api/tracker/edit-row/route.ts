import fs from "node:fs";
import { rootScript } from "@/lib/career-ops";
import { runCoreCli } from "@/lib/core-cli";
import { isTrackerWriting } from "@/lib/core/run-registry";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Edit the Company, Role or City of one tracker row from the Pipeline table.
// Delegates to edit-row.mjs, which holds the tracker lock and replaces only
// those cells; this route never touches applications.md itself.

const FIELDS = ["company", "role", "city"] as const;
const EXIT_TO_HTTP: Record<number, number> = { 1: 400, 2: 404, 3: 409, 4: 503 };

export async function POST(req: Request) {
  const body = await readJsonObject<Record<string, unknown>>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const n = String(body.n ?? "").trim();
  if (!/^\d+$/.test(n)) return Response.json({ error: "A tracker row number is required." }, { status: 400 });

  // `--field=value`, one argv entry each: no shell, and a value that starts
  // with a dash cannot be read as a flag.
  const args = ["--row", n, "--json"];
  for (const field of FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > 300) {
      return Response.json({ error: `${field} must be text.` }, { status: 400 });
    }
    args.push(`--${field}=${value}`);
  }
  if (args.length === 3) return Response.json({ error: "Nothing to change." }, { status: 400 });

  if (!fs.existsSync(rootScript("edit-row"))) {
    return Response.json({ error: "Editing rows needs a newer career-ops checkout (edit-row.mjs)." }, { status: 503 });
  }
  if (isTrackerWriting()) {
    return Response.json({ error: "Your tracker is being updated right now. Try again in a moment." }, { status: 409 });
  }

  const run = await runCoreCli("edit-row", args);
  if (run.spawnFailed) {
    console.error(`/api/tracker/edit-row: edit-row.mjs failed to run: ${run.stderr.trim()}`);
    return Response.json({ error: "The edit could not run." }, { status: 500 });
  }
  if (run.timedOut) {
    return Response.json({ error: "The edit timed out; it may or may not have been saved. Reload to check." }, { status: 504 });
  }
  let parsed: { ok?: boolean; message?: string; changed?: string[]; after?: Record<string, string> } | null = null;
  try {
    parsed = JSON.parse(run.stdout.trim().split("\n").pop() || "");
  } catch {
    parsed = null;
  }
  if (run.code !== 0 || !parsed?.ok) {
    if (!parsed) console.error(`/api/tracker/edit-row: exit ${run.code}: ${run.stderr.trim()}`);
    return Response.json({ error: parsed?.message || "The edit failed." }, { status: EXIT_TO_HTTP[run.code] ?? 500 });
  }
  return Response.json({ ok: true, changed: parsed.changed ?? [], after: parsed.after ?? {} });
}
