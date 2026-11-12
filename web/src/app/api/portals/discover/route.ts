import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { resolveCliOrFallback } from "@/lib/clis";
import { scopeFrom } from "@/lib/claude-invocation.mjs";
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
// Web search and page fetches only: the agent reads the open web, so it gets no
// file or shell tool, and its answer is validated before anything is written.
const AGENT_SCOPE = scopeFrom("WebFetch,WebSearch");

/** Run discover-ats.mjs on one company. Preview unless `write`. */
function lookup(name: string, hints: Record<string, unknown>, write: boolean): Promise<Discovery> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-discover-"));
  const file = path.join(dir, "companies.yml");
  fs.writeFileSync(file, discoveryInput(name, hints));
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [rootScript("discover-ats"), "--in", file, ...(write ? ["--write"] : [])],
      { cwd: resolveCodeRoot(process.cwd(), process.env), timeout: LOOKUP_TIMEOUT_MS, env: process.env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        fs.rmSync(dir, { recursive: true, force: true });
        const killed = (err as { killed?: boolean } | null)?.killed === true;
        if (killed) return resolve({ status: "error", reason: "The board lookup timed out. Try again." });
        // discover-ats exits non-zero when nothing resolved; its JSON still says why.
        resolve(readDiscovery(stdout || ""));
      },
    );
  });
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
    ? ["-p", prompt, "--model", TIER_MODELS.economy, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", AGENT_SCOPE.allowed, "--disallowedTools", AGENT_SCOPE.disallowed]
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

