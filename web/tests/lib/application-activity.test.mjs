import test from "node:test";
import assert from "node:assert/strict";
import { appliedDateFromNotes, applicationSource, computeApplicationActivity, workArrangement } from "../../src/lib/application-activity.mjs";

const app = (n, status, notes, extra = {}) => ({ n: String(n), date: "2026-11-01", status, notes, url: "[linkedin.com](https://www.linkedin.com/jobs/view/1/)", ...extra });

test("only applications that went out are counted, evaluations are not", () => {
  const r = computeApplicationActivity({
    applications: [app(1, "Evaluated", ""), app(2, "SKIP", ""), app(3, "Applied", "Applied 2026-11-02; Hybrid"), app(4, "Rejected", "Applied 2026-10-01")],
    statusLog: [],
    today: "2026-11-12",
  });
  assert.equal(r.total, 2);
  assert.equal(r.awaiting, 1);
  assert.equal(r.rejected, 1);
});

test("response time runs from the applied date to the ledger's first reply", () => {
  const r = computeApplicationActivity({
    applications: [app(1, "Rejected", "Applied 2026-07-11"), app(2, "Rejected", "Applied 2026-08-15"), app(3, "Applied", "Applied 2026-08-20")],
    statusLog: [
      { num: 1, date: "2026-07-29", from: "Applied", to: "Rejected" },
      { num: 2, date: "2026-08-27", from: "Applied", to: "Rejected" },
    ],
    today: "2026-11-12",
  });
  assert.equal(r.responseSamples, 2);
  assert.equal(r.avgResponseDays, 15); // 18 and 12 days
  assert.equal(r.medianResponseDays, 15);
  assert.equal(r.responses, 2);
  assert.equal(r.responseRate, (2 / 3) * 100);
});

test("a reply status with no dated ledger line counts as a response, without a time", () => {
  const r = computeApplicationActivity({ applications: [app(1, "Rejected", "Applied 2026-07-11")], statusLog: [], today: "2026-11-12" });
  assert.equal(r.responses, 1);
  assert.equal(r.responseSamples, 0);
  assert.equal(r.avgResponseDays, null);
});

test("a row discarded after it was sent still counts, through the ledger", () => {
  const r = computeApplicationActivity({
    applications: [app(1, "Discarded", "")],
    statusLog: [{ num: 1, date: "2026-10-01", from: "Evaluated", to: "Applied" }],
    today: "2026-11-12",
  });
  assert.equal(r.total, 1);
});

test("twelve months end with today's, and count applications and responses per month", () => {
  const r = computeApplicationActivity({
    applications: [app(1, "Rejected", "Applied 2026-07-11"), app(2, "Applied", "Applied 2026-07-30"), app(3, "Applied", "Applied 2025-10-01")],
    statusLog: [{ num: 1, date: "2026-08-04", from: "Applied", to: "Rejected" }],
    today: "2026-11-12",
  });
  assert.equal(r.months.length, 12);
  assert.deepEqual([r.months[0].key, r.months.at(-1).key], ["2025-12", "2026-11"]);
  const jul = r.months.find((m) => m.key === "2026-07");
  const aug = r.months.find((m) => m.key === "2026-08");
  assert.deepEqual([jul.applied, jul.responses, aug.responses], [2, 0, 1]);
  assert.equal(jul.label, "Jul 26");
});

test("recent windows, pace and goals", () => {
  const r = computeApplicationActivity({
    applications: [app(1, "Applied", "Applied 2026-11-12"), app(2, "Applied", "Applied 2026-11-06"), app(3, "Applied", "Applied 2026-10-14"), app(4, "Applied", "Applied 2026-10-13")],
    statusLog: [],
    today: "2026-11-12",
    goals: { perYear: 250, per30Days: 30 },
  });
  assert.deepEqual([r.last7, r.last30, r.thisMonth, r.thisYear], [2, 3, 2, 4]);
  assert.equal(r.trackingDays, 30); // 2026-11-12 minus 2026-10-13, as the workbook counted
  assert.equal(r.perDay, 4 / 30);
  assert.deepEqual(r.goals.rolling30, { target: 30, count: 3, pct: 10 });
  assert.equal(r.goals.year.count, 4); // every application sent
  assert.equal(computeApplicationActivity({ applications: [], statusLog: [], today: "2026-11-12" }).goals.year, null);
});

test("dates, sources and arrangements are read the way the tracker writes them", () => {
  assert.equal(appliedDateFromNotes("imported; Applied 2026-06-28; x"), "2026-06-28");
  assert.equal(appliedDateFromNotes("Applied 2026-02-31"), null);
  assert.equal(applicationSource("[linkedin.com](https://www.linkedin.com/jobs/view/1/)"), "LinkedIn");
  assert.equal(applicationSource("https://au.seek.com/job/1"), "SEEK");
  assert.equal(applicationSource("[ashby](https://jobs.ashbyhq.com/x/1)"), "Company careers site");
  assert.equal(applicationSource(""), "Unknown");
  assert.equal(workArrangement("via LinkedIn; On-site"), "On-site");
  assert.equal(workArrangement("Remote; x"), "Remote");
  assert.equal(workArrangement("nothing"), "Not specified");
});

test("the pipeline lists every stage, and the rejection rate is over everything sent", () => {
  const r = computeApplicationActivity({
    applications: [app(1, "Applied", ""), app(2, "Rejected", ""), app(3, "Rejected", ""), app(4, "Interview", ""), app(5, "Discarded", "")],
    statusLog: [{ num: 5, date: "2026-10-01", from: "Evaluated", to: "Applied" }],
    today: "2026-11-12",
  });
  assert.deepEqual(r.pipeline.map((p) => [p.label, p.count]), [["Applied", 1], ["Responded", 0], ["Assessment", 0], ["Interview", 1], ["Offer", 0], ["Hired", 0], ["Rejected", 2], ["Withdrawn", 1]]);
  assert.equal(r.rejectionRate, 40);
});
