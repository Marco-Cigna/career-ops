// Runs the user's local tools (local-tools.mjs) in the background and keeps
// their last run in {DATA_ROOT}/data/local-tools-runs.json, so the Tools page can
// say when each one last ran even after the dashboard restarts.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWrite } from "@/lib/core/safe-write";
import { outputTail, parseLocalTools, resolveStep, type LocalTool } from "@/lib/local-tools.mjs";

export type LocalToolRun = {
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  exitCode: number | null;
  message: string;
  output: string;
};

const running = new Map<string, LocalToolRun>();

export function localToolsConfigPath(): string {
  return path.join(careerOpsRoot(), "config", "local-tools.yml");
}

function runsPath(): string {
  return path.join(careerOpsRoot(), "data", "local-tools-runs.json");
}

export function readLocalTools(): { tools: LocalTool[]; problems: string[]; exists: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(localToolsConfigPath(), "utf8");
  } catch {
    return { tools: [], problems: [], exists: false };
  }
  return { ...parseLocalTools(text), exists: true };
}

export function readRuns(): Record<string, LocalToolRun> {
  const saved: Record<string, LocalToolRun> = (() => {
    try {
      const data = JSON.parse(fs.readFileSync(runsPath(), "utf8"));
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  })();
  // A run in progress in this server outranks the last finished one.
  for (const [id, run] of running) saved[id] = run;
  return saved;
}

function saveRun(id: string, run: LocalToolRun) {
  try {
    const all = (() => {
      try {
        return JSON.parse(fs.readFileSync(runsPath(), "utf8")) as Record<string, LocalToolRun>;
      } catch {
        return {} as Record<string, LocalToolRun>;
      }
    })();
    all[id] = run;
    fs.mkdirSync(path.dirname(runsPath()), { recursive: true });
    atomicWrite(runsPath(), JSON.stringify(all, null, 2));
  } catch {
    // The run happened; only its record is lost.
  }
}

/** A file another program holds open for writing (Excel with a workbook open). */
function isLockedElsewhere(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r+");
    fs.closeSync(fd);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES";
  }
}

function runStep(command: string, args: string[], cwd: string | null, deadline: number, log: (s: string) => void): Promise<number | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: cwd ?? careerOpsRoot(),
        // CAREER_OPS_NODE: the dashboard's own Node, for a script that runs career-ops
        // scripts itself (a node on PATH may be a version-manager shim, or absent).
        env: { ...process.env, CAREER_OPS_ROOT: careerOpsRoot(), CAREER_OPS_CODE_ROOT: resolveCodeRoot(process.cwd(), process.env), CAREER_OPS_NODE: process.execPath, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
        // No shell: the arguments are passed as they are written in the config.
        shell: false,
        // A window of its own is the program's business (a browser it opens
        // still shows); the console itself stays hidden.
        windowsHide: true,
      });
    } catch (err) {
      log(`Could not start ${command}: ${(err as Error).message}\n`);
      return resolve(null);
    }
    const timer = setTimeout(() => {
      log(`\nStopped: the run passed its time limit.\n`);
      try { child.kill(); } catch { /* ignore */ }
    }, Math.max(1_000, deadline - Date.now()));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", log);
    child.stderr?.on("data", log);
    child.stdin?.end();
    child.on("error", (err) => { log(`\n${command}: ${err.message}\n`); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code); });
  });
}

/**
 * Start a tool in the background. Returns null when it started, or the reason
 * it did not (unknown id, already running, a file it waits for is open).
 */
export function startLocalTool(id: string): string | null {
  const { tools } = readLocalTools();
  const tool = tools.find((t) => t.id === id);
  if (!tool) return "Unknown script. Check config/local-tools.yml.";
  if (running.has(id)) return "It is already running.";
  const open = tool.waitForClosed.find((f) => fs.existsSync(f) && isLockedElsewhere(f));
  if (open) return `${path.basename(open)} is open in another program. Close it and run again.`;

  const run: LocalToolRun = { startedAt: new Date().toISOString(), finishedAt: null, ok: null, exitCode: null, message: "Running…", output: "" };
  running.set(id, run);
  const log = (s: string) => { run.output = outputTail(run.output + s); };
  const roots = { dataRoot: careerOpsRoot(), codeRoot: resolveCodeRoot(process.cwd(), process.env), nodePath: process.execPath };
  const deadline = Date.now() + tool.timeoutMs;

  void (async () => {
    for (const [i, step] of tool.steps.entries()) {
      const { command, args, cwd } = resolveStep(step, roots);
      log(`\n▶ Step ${i + 1} of ${tool.steps.length}: ${path.basename(command)} ${args.map((a) => path.basename(a)).join(" ")}\n`);
      const code = await runStep(command, args, cwd, deadline, log);
      run.exitCode = code;
      if (code !== 0) {
        run.ok = false;
        run.message = code === null ? `Step ${i + 1} did not finish.` : `Step ${i + 1} failed (exit ${code}).`;
        break;
      }
    }
    if (run.ok === null) {
      run.ok = true;
      run.message = "Finished.";
    }
    run.finishedAt = new Date().toISOString();
    running.delete(id);
    saveRun(id, run);
  })();
  return null;
}
