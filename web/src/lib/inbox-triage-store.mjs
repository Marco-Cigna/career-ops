// Inbox filter results: what pre-screen and triage said about each posting.
//
// Written by the inbox Filter button and by the gate in front of every Score
// run (pipeline-gate-run.ts), so a posting the Filter already passed is not
// triaged a second time when it is scored, and the inbox can show the verdict.
// Lives in the data root (user layer). Plain .mjs so the tests import it.
//
// Shape: { "<posting url>": { verdict, score, reason, model, at } }
//   verdict: PASS | MARGINAL | FAIL | SKIP_RULES | CLOSED | UNCHECKED

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TRIAGE_STORE_FILE = path.join("data", "inbox-triage.json");
/** A PASS older than this is triaged again: the profile or the posting may have changed. */
export const PASS_REUSE_DAYS = 14;

/** @typedef {{verdict: string, score: number|null, reason: string, model: string|null, at: string}} TriageEntry */

/** @returns {Record<string, TriageEntry>} */
export function readTriageStore(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, TRIAGE_STORE_FILE), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// One web process writes this file, so an in-process chain is enough to keep
// parallel filter calls from losing each other's entries.
let chain = Promise.resolve();

/**
 * @param {string} root
 * @param {string} url
 * @param {TriageEntry} entry
 * @returns {Promise<void>}
 */
export function recordTriage(root, url, entry) {
  const write = () => {
    const file = path.join(root, TRIAGE_STORE_FILE);
    const store = readTriageStore(root);
    store[url] = entry;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1) + "\n", "utf8");
    fs.renameSync(tmp, file);
  };
  chain = chain.then(write, write);
  return chain;
}

/**
 * The store entry a gate result means. Null when the gate never reached a
 * verdict worth keeping (it failed and let the posting through).
 *
 * @param {{skip: boolean, stage?: string, reason?: string, triage?: {verdict: string, score: number|null, reason: string, model: string} | null, notes: string[]}} gate
 * @param {string} at
 * @returns {TriageEntry | null}
 */
export function triageEntryFromGate(gate, at) {
  if (gate.skip && gate.stage === "prescreen") return { verdict: "SKIP_RULES", score: null, reason: gate.reason ?? "", model: null, at };
  if (gate.triage) return { verdict: gate.triage.verdict, score: gate.triage.score, reason: gate.triage.reason, model: gate.triage.model, at };
  return null;
}

/**
 * A recent PASS for this posting, which the Score gate reuses instead of paying
 * for triage again.
 *
 * @param {TriageEntry | undefined} entry
 * @param {number} nowMs
 */
export function reusablePass(entry, nowMs) {
  if (!entry || entry.verdict !== "PASS") return null;
  const at = Date.parse(entry.at);
  if (!Number.isFinite(at) || nowMs - at > PASS_REUSE_DAYS * 86_400_000) return null;
  return entry;
}
