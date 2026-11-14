import { NextResponse } from "next/server";
import { findBin } from "@/lib/clis";
import { isTrackerWriting } from "@/lib/core/run-registry";
import { readJsonObject } from "@/lib/json-body";
import { parseAccountList, runCswap, switchArgs } from "@/lib/claude-accounts.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Config page's Claude account picker, backed by claude-swap (cswap). See
// lib/claude-accounts.mjs: a switch is global, so it changes the account for
// the user's terminal Claude sessions too, which the page says next to the button.

// `cswap list` fetches live usage for every account, a network round trip each.
const LIST_TIMEOUT_MS = 30_000;
const SWITCH_TIMEOUT_MS = 60_000;

const lastLine = (text: string) => text.trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300) ?? "";

async function list(bin: string) {
  const r = await runCswap(bin, ["list", "--json"], LIST_TIMEOUT_MS);
  if (r.code !== 0) throw new Error(lastLine(r.stderr) || "cswap list failed");
  return parseAccountList(r.stdout);
}

function cswapBin(): string | null {
  return findBin("cswap") ?? findBin("claude-swap");
}

export async function GET() {
  const bin = cswapBin();
  if (!bin) return NextResponse.json({ available: false });
  try {
    return NextResponse.json({ available: true, ...(await list(bin)) });
  } catch (e) {
    return NextResponse.json({ available: true, error: `Could not read your Claude accounts: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const bin = cswapBin();
  if (!bin) return NextResponse.json({ error: "claude-swap (cswap) is not installed." }, { status: 404 });
  const body = await readJsonObject<{ target?: unknown; force?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  // A running evaluation keeps its own login, but it refreshes its token from the
  // live store, so a swap mid-run can finish that run on the other account. Ask first.
  if (isTrackerWriting() && body.force !== true) {
    return NextResponse.json({ code: "RUN_IN_FLIGHT", error: "An evaluation is running. Switching now may finish it on the other account." }, { status: 409 });
  }
  let current;
  try {
    current = await list(bin);
  } catch (e) {
    return NextResponse.json({ error: `Could not read your Claude accounts: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const args = switchArgs(body.target, current.accounts.map((a) => a.number));
  if (!args) return NextResponse.json({ error: "Unknown account." }, { status: 400 });
  const r = await runCswap(bin, args, SWITCH_TIMEOUT_MS);
  if (r.code !== 0) {
    return NextResponse.json({ error: lastLine(r.stderr) || lastLine(r.stdout) || "cswap switch failed" }, { status: 502 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await list(bin)) });
  } catch {
    return NextResponse.json({ ok: true, ...current, activeNumber: null });
  }
}
