import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { rootScript } from "@/lib/career-ops";
import { runCoreScriptLong } from "@/lib/core-script-long";
import { resolveCliOrFallback } from "@/lib/clis";
import { claudeWebSearchArgs } from "@/lib/claude-invocation.mjs";
import { readJsonObject } from "@/lib/json-body";
import { TIER_MODELS } from "@/lib/pipeline-gate.mjs";
import { agentPrompt, companyName, discoveryInput, readAgentAnswer, readDiscovery, safeHints, type Discovery } from "@/lib/portal-discovery.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOOKUP_TIMEOUT_MS = 90_000;
const AGENT_TIMEOUT_MS = 180_000;

/** Run discover-ats.mjs on one company. Preview unless `write`. */
function lookup(name: string, hints: Record<string, unknown>, write: boolean): Promise<Discovery> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-discover-"));
  const file = path.join(dir, "companies.yml");
  fs.writeFileSync(file, discoveryInput(name, hints));
  return runCoreScriptLong("discover-ats", ["--in", file, ...(write ? ["--write"] : [])], LOOKUP_TIMEOUT_MS)
    .then((run): Discovery => {
      // discover-ats exits non-zero when nothing resolved; its JSON still says why.
      return run.timedOut ? { status: "error", reason: "The board lookup timed out. Try again." } : readDiscovery(run.stdout);
    })
    .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/** One web-search agent run. Resolves to its final text, "" on any failure. */
function askAgent(binPath: string, cliId: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let child: ReturnType<typeof spawnHeadlessCli> | undefined;
    const finish = (value: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const stop = () => { try { child?.kill("SIGTERM"); } catch { /* ignore */ } finish(""); };
    const timer = setTimeout(stop, AGENT_TIMEOUT_MS);
    try {
      child = spawnHeadlessCli(binPath, args, { cwd, env: process.env }, { cliId, capabilities: CAPS.networkReadOnly });
    } catch {
      return finish("");
    }
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.resume();
    child.on("error", () => finish(""));
    child.on("close", (code) => finish(code === 0 ? out : ""));
  });
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ company?: unknown; write?: unknown; agent?: unknown; hints?: unknown; cliId?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const name = companyName(body.company);
  if (!name) return NextResponse.json({ error: "Enter a company name (letters, numbers and common punctuation, up to 80 characters)." }, { status: 400 });
  if (!fs.existsSync(rootScript("discover-ats"))) {
    return NextResponse.json({ error: "This needs a complete career-ops checkout (discover-ats.mjs)." }, { status: 503 });
  }
  const write = body.write === true;
  const hints = safeHints(body.hints);

  if (body.agent !== true) {
    return NextResponse.json({ ...(await lookup(name, hints, write)), hints });
  }

  // The name alone resolved nothing: let an agent find the careers page, then
  // hand what it found back to the same live lookup. Nothing is written here.
  const resolved = typeof body.cliId === "string" ? resolveCliOrFallback(body.cliId) : null;
  if (!resolved) return NextResponse.json({ error: "No AI CLI is configured. Open Config and save one." }, { status: 400 });
  const { spec, binPath } = resolved;
  const prompt = agentPrompt(name);
  const args = spec.id === "claude"
    ? claudeWebSearchArgs({ prompt, model: TIER_MODELS.economy })
    : spec.args(prompt);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-agent-"));
  let answer = "";
  try {
    answer = await askAgent(binPath, spec.id, args, cwd, req.signal);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  if (!answer.trim()) return NextResponse.json({ status: "error", reason: "The agent returned nothing. Check that your AI CLI is signed in, then try again." });
  const found = readAgentAnswer(answer);
  const result = await lookup(name, found.hints, false);
  return NextResponse.json({ ...result, hints: found.hints, agent: { careersUrl: found.careersUrl, note: found.note } });
}

