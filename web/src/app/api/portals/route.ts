import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { appendPortalTitlesText, loadPortalsDocument, mergePortalFilters, patchPortalFiltersText, PortalsConfigError } from "@/lib/portals-config.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for portals.yml's web-owned filters (a USER-LAYER file).
// Replaces title_filter.positive and, when provided, location_filter.allow;
// seeds from templates/portals.example.yml on first create; and PRESERVES
// tracked_companies plus every other block. Atomic write, confirm-gated
// (setProfile/setPortals). This loads the first home scan after role confirmation.
// The two lists are edited in the file's text so its comments and commented-out
// companies survive; yaml.dump is only the fallback for a shape the text edit
// cannot place.

export async function POST(req: Request) {
  const body = await readJsonObject<{ roles?: string[]; location?: string[]; merge?: boolean }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const roles = (Array.isArray(body.roles) ? body.roles : []).map((r) => String(r).trim()).filter(Boolean).slice(0, 24);
  if (roles.length === 0) return Response.json({ error: "no roles" }, { status: 400 });

  const root = careerOpsRoot();
  const file = portalsConfigPath(root);
  let doc: Record<string, unknown>;
  let source: string;
  let seeded: boolean;
  try {
    ({ doc, source, seeded } = loadPortalsDocument(file, path.join(resolveCodeRoot(process.cwd(), process.env), "templates", "portals.example.yml")));
  } catch (error) {
    const invalidUserConfig = error instanceof PortalsConfigError && error.kind === "invalid-user-config";
    return Response.json(
      { error: error instanceof Error ? error.message : "could not load portals.yml" },
      { status: invalidUserConfig ? 409 : 500 },
    );
  }

  // merge: add the titles to an existing list and leave everything else,
  // the location filter included, alone. A first portals.yml (seeded from the
  // template) still gets the replace below: the template's keywords are
  // someone else's.
  if (body.merge === true && !seeded) {
    const appended = appendPortalTitlesText(source, roles);
    if (!appended) {
      return Response.json({ error: "the title list in portals.yml has a shape this edit cannot place; add the titles on the Profile page (Job boards)" }, { status: 409 });
    }
    if (appended.added.length === 0) return Response.json({ ok: true, roles: 0 });
    try {
      atomicWriteWithBackup(file, appended.text);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
    }
    return Response.json({ ok: true, roles: appended.added.length, added: appended.added });
  }

  const locations = Array.isArray(body.location)
    ? body.location.map((l) => String(l).trim()).filter(Boolean)
    : undefined;
  const text = patchPortalFiltersText(source, roles, locations)
    ?? yaml.dump(mergePortalFilters(doc, roles, locations), { lineWidth: 100, noRefs: true });

  try {
    atomicWriteWithBackup(file, text);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length });
}
