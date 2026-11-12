/**
 * profile-files.mjs — the user-layer files the Profile page edits.
 *
 * A closed list: a request names an id, never a path, so the page can reach
 * these files and nothing else. They are the user's own (DATA_CONTRACT.md user
 * layer): updates never touch them, and they live under the data root, which
 * is outside the code checkout.
 *
 * cv.md is not here. It has its own page (/cv) with a preview.
 */
import * as yaml from "js-yaml";
import { cvBaseMatches } from "./cv-write.mjs";

/**
 * @typedef {{id: string, label: string, description: string, file: string, kind: "markdown"|"yaml"}} ProfileFile
 * `file` is relative to the data root; config/profile.yml and portals.yml are
 * resolved by the caller instead, because environment overrides can move them.
 * @type {readonly ProfileFile[]}
 */
export const PROFILE_FILES = Object.freeze([
  { id: "targeting", label: "Targeting", description: "Target roles, deal-breakers, framing per role type, comp targets, negotiation scripts, exit story and location policy. Every evaluation scores against this.", file: "modes/_profile.md", kind: "markdown" },
  { id: "settings", label: "Settings", description: "Contact details, target titles and archetypes, salary, work rights, spend tier, CV template and pipeline limits.", file: "config/profile.yml", kind: "yaml" },
  { id: "proof", label: "Proof points", description: "The detail behind your CV: projects, metrics and their status. Tailored CVs and cover letters draw on it.", file: "article-digest.md", kind: "markdown" },
  { id: "rules", label: "House rules", description: "How things should be written and done: wording, spelling, claims that need your confirmation, pipeline rules.", file: "modes/_custom.md", kind: "markdown" },
  { id: "brief", label: "Triage brief", description: "The short version of you that the cheap first-pass triage reads. Keep it in step with Targeting.", file: "modes/_brief.md", kind: "markdown" },
  { id: "portals", label: "Job boards", description: "Companies to watch and the title, location and age filters the scanner applies.", file: "portals.yml", kind: "yaml" },
]);

const MAX_BYTES = 1_000_000;

/** @param {unknown} id */
export function profileFile(id) {
  return PROFILE_FILES.find((f) => f.id === id) ?? null;
}

export const PROFILE_CONFLICT_ERROR = "This file changed somewhere else since you opened it. Your text is still here; reload to see the other version.";

/**
 * Decide whether a save may go ahead.
 *
 * @param {ProfileFile} spec
 * @param {{exists: boolean, content: string}} disk
 * @param {unknown} body `{content, expected: {content, exists}}`
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
export function decideProfileWrite(spec, disk, body) {
  const b = /** @type {{content?: unknown, expected?: {content?: unknown, exists?: unknown}}} */ (body ?? {});
  if (typeof b.content !== "string") return { ok: false, status: 400, error: "content required" };
  if (Buffer.byteLength(b.content, "utf8") > MAX_BYTES) return { ok: false, status: 413, error: "The file is too large (over 1 MB)." };
  const expected = b.expected;
  if (!expected || typeof expected.content !== "string" || typeof expected.exists !== "boolean"
    || !cvBaseMatches(disk, { exists: expected.exists, content: expected.content })) {
    return { ok: false, status: 409, error: PROFILE_CONFLICT_ERROR };
  }
  if (spec.kind === "yaml") {
    try {
      const doc = yaml.load(b.content);
      if (doc !== undefined && doc !== null && (typeof doc !== "object" || Array.isArray(doc))) {
        return { ok: false, status: 422, error: "This file must be a YAML mapping (key: value lines at the top level)." };
      }
    } catch (err) {
      const mark = /** @type {{mark?: {line?: number}, reason?: string}} */ (err);
      const where = typeof mark.mark?.line === "number" ? ` on line ${mark.mark.line + 1}` : "";
      return { ok: false, status: 422, error: `Not saved: the YAML has an error${where}${mark.reason ? ` (${mark.reason})` : ""}.` };
    }
  }
  return { ok: true };
}
