// runCoreCli (core-cli.ts) with a caller-chosen timeout and combined output, for
// the scripts a 30-second HTTP budget cannot cover: a board lookup that probes
// a dozen vendors, a health check over every report. Same launch rules as there:
// the server's own node, the checkout as cwd, never an inherited console.
import { execFile } from "node:child_process";
import { rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";

export type LongResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

export function runCoreScriptLong(script: string, args: string[], timeoutMs: number): Promise<LongResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [rootScript(script), ...args],
      {
        cwd: resolveCodeRoot(process.cwd(), process.env),
        timeout: timeoutMs,
        env: { ...process.env, NO_COLOR: "1" },
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          code: typeof e?.code === "number" ? e.code : e ? -1 : 0,
          stdout: stdout || "",
          stderr: stderr || "",
          timedOut: e?.killed === true,
        });
      },
    );
  });
}
