import fs from "node:fs";
import * as yaml from "js-yaml";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { readJsonObject } from "@/lib/json-body";
import { patchProfileText } from "@/lib/profile-yaml-edit.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GOAL = 10_000;

/** A whole number from 1 to MAX_GOAL, or null to clear the goal. */
function goalValue(v: unknown): number | null | undefined {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_GOAL ? n : undefined;
}

// Saves goals.applications_per_year / goals.applications_per_30_days in
// config/profile.yml, editing only those lines so the file keeps its comments.
export async function POST(req: Request) {
  const body = await readJsonObject<{ perYear?: unknown; per30Days?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const perYear = goalValue(body.perYear);
  const per30Days = goalValue(body.per30Days);
  if (perYear === undefined || per30Days === undefined) {
    return NextResponse.json({ error: `Goals must be whole numbers from 1 to ${MAX_GOAL}, or empty to clear.` }, { status: 400 });
  }
  const file = getProfilePath(careerOpsRoot());
  let source: string;
  let doc: Record<string, unknown>;
  try {
    source = fs.readFileSync(file, "utf8");
    const parsed = yaml.load(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a mapping");
    doc = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "config/profile.yml could not be read. Fix it on the Profile page first." }, { status: 409 });
  }
  const current = doc.goals && typeof doc.goals === "object" && !Array.isArray(doc.goals) ? (doc.goals as Record<string, unknown>) : {};
  const goals: Record<string, number> = {};
  for (const [key, value] of Object.entries(current)) if (key !== "applications_per_year" && key !== "applications_per_30_days" && typeof value === "number") goals[key] = value;
  if (perYear !== null) goals.applications_per_year = perYear;
  if (per30Days !== null) goals.applications_per_30_days = per30Days;
  const expected = { ...doc, goals };
  const text = patchProfileText(source, { goals }, expected);
  if (text === null) {
    return NextResponse.json({ error: "The goals block in config/profile.yml has a shape this edit cannot change safely. Edit it on the Profile page (Settings)." }, { status: 409 });
  }
  try {
    atomicWriteWithBackup(file, text);
  } catch {
    return NextResponse.json({ error: "config/profile.yml could not be saved." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, perYear, per30Days });
}
