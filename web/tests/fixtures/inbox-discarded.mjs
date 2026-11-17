// Previously filtered postings plus one tracked discard and two pending jobs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-inbox-discarded-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".discarded-inbox-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional fixture\n");
fs.writeFileSync(path.join(root, "data/pipeline.md"), `## Pending
- [x] https://example.test/low | Fixture Low | Engineer | Sydney
- [x] https://example.test/marginal | Fixture Marginal | Designer | Melbourne
- [x] https://example.test/rule | Fixture Rule | Analyst | Sydney
- [x] https://example.test/closed | Fixture Closed | Engineer | Brisbane
- [x] https://example.test/tracked | Fixture Tracked | Engineer | Sydney
- [x] https://example.test/manual | Fixture Manual | Designer | Perth
- [x] https://example.test/scored | Fixture Scored | Analyst | Sydney
- [ ] https://example.test/unreadable | Fixture Unreadable | Engineer | Sydney
- [ ] https://example.test/pending | Fixture Pending | Engineer | Sydney
`);
fs.writeFileSync(path.join(root, "data/applications.md"), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | Fixture Tracked | Engineer | 3.8/5 | Discarded | — | — | Existing tracker discard | [posting](https://example.test/tracked) |
| 2 | 2026-11-16 | Fixture Scored | Analyst | 4.2/5 | Evaluated | — | — | Scored | [posting](https://example.test/scored) |
`);
const store = {};
for (const [id, verdict, score, reason] of [
  ["low", "FAIL", 2, "Insufficient required skills"],
  ["marginal", "MARGINAL", 3.2, "Limited role match"],
  ["rule", "SKIP_RULES", null, "Requires 6+ years"],
  ["closed", "CLOSED", null, "Posting closed"],
  ["tracked", "FAIL", 2.5, "Earlier triage"],
  ["scored", "PASS", 4.2, "Passed"],
  ["unreadable", "UNCHECKED", null, "Posting could not be read"],
]) store[`https://example.test/${id}`] = { verdict, score, reason, model: null, at: "2026-11-16T01:00:00Z" };
fs.writeFileSync(path.join(root, "data/inbox-triage.json"), JSON.stringify(store));
console.log(root);
