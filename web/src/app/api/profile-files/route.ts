import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { readJsonObject } from "@/lib/json-body";
import { decideProfileWrite, profileFile, type ProfileFile } from "@/lib/profile-files.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Profile page's read and save. A request names a file by id from the
// closed list in profile-files.mjs; the path is resolved here, never taken
// from the request.
function filePath(spec: ProfileFile): string {
  const root = careerOpsRoot();
  // Environment overrides can move these two, so ask their resolvers.
  if (spec.id === "settings") return getProfilePath(root);
  if (spec.id === "portals") return portalsConfigPath(root);
  return path.join(root, spec.file);
}

function read(file: string): { exists: boolean; content: string } {
  try {
    return { exists: true, content: fs.readFileSync(file, "utf8") };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, content: "" };
    throw err;
  }
}

export async function GET(req: Request) {
  const spec = profileFile(new URL(req.url).searchParams.get("id"));
  if (!spec) return NextResponse.json({ error: "Unknown file." }, { status: 400 });
  try {
    return NextResponse.json(read(filePath(spec)));
  } catch {
    return NextResponse.json({ error: `Couldn't read ${spec.file}.` }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ id?: unknown; content?: unknown; expected?: { content?: unknown; exists?: unknown } }>(req);
  const spec = profileFile(body?.id);
  if (!body || !spec) return NextResponse.json({ error: "Unknown file." }, { status: 400 });
  const file = filePath(spec);
  let disk: { exists: boolean; content: string };
  try {
    disk = read(file);
  } catch {
    return NextResponse.json({ error: `Couldn't read ${spec.file}.` }, { status: 500 });
  }
  const decision = decideProfileWrite(spec, disk, body);
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const backup = atomicWriteWithBackup(file, body.content as string);
    return NextResponse.json({ ok: true, backup: backup ? path.basename(backup) : null });
  } catch {
    return NextResponse.json({ error: `Couldn't save ${spec.file}.` }, { status: 500 });
  }
}
