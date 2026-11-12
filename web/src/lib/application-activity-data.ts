// Server-side inputs for the Applications panel: goals from config/profile.yml.
import fs from "node:fs";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";

export type ActivityGoals = { perYear: number | null; per30Days: number | null };

const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** goals.applications_per_year / goals.applications_per_30_days, when set. */
export function readActivityGoals(): ActivityGoals {
  try {
    const doc = yaml.load(fs.readFileSync(getProfilePath(careerOpsRoot()), "utf8")) as { goals?: Record<string, unknown> } | null;
    return { perYear: positive(doc?.goals?.applications_per_year), per30Days: positive(doc?.goals?.applications_per_30_days) };
  } catch {
    return { perYear: null, per30Days: null };
  }
}
