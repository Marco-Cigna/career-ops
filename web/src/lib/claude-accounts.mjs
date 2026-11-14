// Claude account switching for the Config page, through claude-swap (`cswap`).
//
// cswap keeps each account's login in its own store and swaps the one that is
// live in ~/.claude, so a switch applies to EVERY Claude Code process on this
// computer: the dashboard's runs and the user's own terminal sessions alike.
// The dashboard never touches credentials itself; it only runs `cswap list`
// and `cswap switch` and shows what they print.
//
// Plain .mjs so tests/lib/claude-accounts.test.mjs can import the real parser.

import { execFile } from "node:child_process";

/**
 * Run cswap with a fixed argv (no shell). Never rejects: a spawn failure is a
 * non-zero code, so the route answers with an error instead of a 500.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {number} timeout
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runCswap(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = !error ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

/**
 * @typedef {{pct: number|null, resetsAt: string|null}} UsageWindow
 * @typedef {{number: number, email: string, active: boolean, plan: string|null, usageStatus: string|null, fiveHour: UsageWindow, sevenDay: UsageWindow, loginExpiresAt: string|null}} ClaudeAccount
 * @typedef {{activeNumber: number|null, accounts: ClaudeAccount[]}} ClaudeAccountList
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v ? v : null);

/** @returns {UsageWindow} */
function usageWindow(w) {
  return { pct: num(w?.pct), resetsAt: str(w?.resetsAt) };
}

/**
 * `cswap list --json` → the accounts the Config page shows. Throws on output
 * that is not the documented shape, so a cswap upgrade that changes it reads
 * as "could not read your accounts", never as a wrong list.
 *
 * @param {string} stdout
 * @returns {ClaudeAccountList}
 */
export function parseAccountList(stdout) {
  const data = JSON.parse(stdout);
  if (!data || !Array.isArray(data.accounts)) throw new Error("cswap list --json has no accounts array");
  const accounts = data.accounts
    .filter((a) => a && Number.isInteger(a.number) && typeof a.email === "string")
    .map((a) => ({
      number: a.number,
      email: a.email,
      active: a.active === true,
      plan: str(a.plan?.label),
      usageStatus: str(a.usageStatus),
      fiveHour: usageWindow(a.usage?.fiveHour),
      sevenDay: usageWindow(a.usage?.sevenDay),
      loginExpiresAt: str(a.loginExpiresAt),
    }));
  const activeNumber = Number.isInteger(data.activeAccountNumber)
    ? data.activeAccountNumber
    : (accounts.find((a) => a.active)?.number ?? null);
  return { activeNumber, accounts };
}

/**
 * The switch a request asks for, as cswap argv. Only an account number cswap
 * listed, or "best" (cswap picks the account with the most 5h/7d headroom).
 * Anything else is null, so request text never reaches the command line.
 *
 * @param {unknown} target
 * @param {number[]} known - account numbers from the current list
 * @returns {string[] | null}
 */
export function switchArgs(target, known) {
  if (target === "best") return ["switch", "--strategy", "best", "--json"];
  const n = typeof target === "number" ? target : typeof target === "string" && /^\d{1,3}$/.test(target) ? Number(target) : NaN;
  if (!Number.isInteger(n) || !known.includes(n)) return null;
  return ["switch", String(n), "--json"];
}
