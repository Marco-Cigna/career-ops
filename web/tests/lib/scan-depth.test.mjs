import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampDepth,
  DEPTH_ALL,
  DEPTH_BUDGET_CEILING_MS,
  DEPTH_STOPS,
  depthBudgetMs,
  depthLabel,
  depthStopIndex,
  estimateScanSeconds,
  formatScanDuration,
} from "../../src/lib/scan-depth.mjs";

test("clampDepth reads numbers, numeric strings and 'all', and bounds them", () => {
  assert.equal(clampDepth(500), 500);
  assert.equal(clampDepth("2000"), 2000);
  assert.equal(clampDepth("all"), DEPTH_ALL);
  assert.equal(clampDepth(10), 50);
  assert.equal(clampDepth(1e9), DEPTH_ALL);
  assert.equal(clampDepth("nope", 150), 150);
  assert.equal(clampDepth("", 150), 150);
  assert.equal(clampDepth(undefined, 150), 150);
});

test("the slider lands an off-stop depth on the nearest stop", () => {
  assert.equal(DEPTH_STOPS[depthStopIndex(500)], 500);
  assert.equal(DEPTH_STOPS[depthStopIndex(300)], 250);
  assert.equal(DEPTH_STOPS[depthStopIndex(DEPTH_ALL)], DEPTH_ALL);
  assert.equal(depthLabel(DEPTH_ALL), "All companies");
  assert.equal(depthLabel(2000), "2,000 companies");
});

test("estimates: parallel takes the slowest source, sequential adds them up", () => {
  const parallel = estimateScanSeconds(["greenhouse", "ashby"], DEPTH_ALL, { parallel: true });
  const sequential = estimateScanSeconds(["greenhouse", "ashby"], DEPTH_ALL, { parallel: false });
  assert.ok(sequential > parallel);
  // Every Workday board is hours of work; every Greenhouse board is minutes.
  assert.ok(estimateScanSeconds(["workday"], DEPTH_ALL) > 3 * 3600);
  assert.ok(estimateScanSeconds(["greenhouse"], DEPTH_ALL) < 15 * 60);
  assert.equal(estimateScanSeconds([], 500), 0);
});

test("the budget never drops below the floor or rises above the ceiling", () => {
  assert.equal(depthBudgetMs(10, 230_000), 230_000);
  assert.equal(depthBudgetMs(1_000, 230_000), 1_560_000);
  assert.equal(depthBudgetMs(1e6, 230_000), DEPTH_BUDGET_CEILING_MS);
});

test("durations read in minutes and hours", () => {
  assert.equal(formatScanDuration(20), "under a minute");
  assert.equal(formatScanDuration(8 * 60), "about 8 min");
  assert.equal(formatScanDuration(5.5 * 3600), "about 5 h 30 min");
});

test("an Explore link carries 'all' and reads it back", async () => {
  const { filtersToParams, paramsToFilters, DEFAULT_FILTERS } = await import("../../src/lib/explore.ts");
  const params = filtersToParams({ ...DEFAULT_FILTERS, limitPerAts: DEPTH_ALL });
  assert.match(params, /limit=all/);
  assert.equal(paramsToFilters(new URLSearchParams(params)).limitPerAts, DEPTH_ALL);
  assert.equal(paramsToFilters(new URLSearchParams("limit=2000")).limitPerAts, 2000);
});
