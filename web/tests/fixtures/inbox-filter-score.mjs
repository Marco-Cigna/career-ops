import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-filter-score-"));
fs.mkdirSync(path.join(root, "data"));
fs.mkdirSync(path.join(root, "config"));
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n");
fs.writeFileSync(path.join(root, "config/profile.yml"), "target_roles:\n  primary: [Engineer]\nlocation:\n  city: Sydney\n");
const rows = [
  ["middle", "Fixture Middle", "2026-11-16", 3.8],
  ["unknown", "Fixture Unknown", "2026-11-16", null],
  ["high", "Fixture High", "2026-11-16", 4.8],
  ["zero", "Fixture Zero", "2026-11-16", 0],
  ["tie", "Fixture Tie", "2026-11-15", 4.8],
  ["unreadable", "Fixture Unreadable", "2026-11-16", null],
];
fs.writeFileSync(path.join(root, "data/pipeline.md"), "## Pending\n" + rows.map(([id, company, posted]) =>
  `- [ ] https://example.test/${id} | ${company} | Engineer | Sydney | posted: ${posted}\n`).join(""));
const store = {};
for (const [id, , , score] of rows) {
  if (id === "unknown") continue;
  store[`https://example.test/${id}`] = {
    verdict: score == null ? "UNCHECKED" : "PASS", score, reason: "Fictional fixture",
    model: "fixture", at: "2026-11-16T01:00:00Z",
  };
}
fs.writeFileSync(path.join(root, "data/inbox-triage.json"), JSON.stringify(store));
console.log(root);
