import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-job-questions-"));
for (const dir of ["data", "reports", "config"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, ".job-questions-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional candidate\n\nDeveloped Python reporting tools at Fixture Systems.\n");
fs.writeFileSync(path.join(root, "config/profile.yml"), "language:\n  output: en\n");
fs.writeFileSync(path.join(root, "data/applications.md"), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|---|---|---|---|---|---|---|---|---|
| 11 | 2026-11-16 | Fixture Alpha | Engineer | 4.2/5 | Evaluated | — | [21](../reports/021-alpha.md) | | [posting](https://example.test/alpha) |
| 12 | 2026-11-16 | Fixture Beta | Analyst | 3.8/5 | Evaluated | — | [22](../reports/022-beta.md) | | [posting](https://example.test/beta) |
`);
for (const [n, company, role] of [[21, "Alpha", "Engineer"], [22, "Beta", "Analyst"]]) {
  fs.writeFileSync(path.join(root, `reports/0${n}-${company.toLowerCase()}.md`), `# Evaluation: Fixture ${company} — ${role}

**Date:** 2026-11-16
**Score:** 4.2/5
**URL:** https://example.test/${company.toLowerCase()}

## B) CV Match

Fictional evaluation, keep this text unchanged.

## Job Description (archived verbatim)

Build Python reporting tools at Fixture ${company}.
`);
}
console.log(root);
