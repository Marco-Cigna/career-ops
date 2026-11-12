import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_FILES, decideProfileWrite, profileFile } from "../../src/lib/profile-files.mjs";

const yamlSpec = profileFile("settings");
const mdSpec = profileFile("targeting");
const disk = { exists: true, content: "a: 1\n" };
const body = (content, expected = disk) => ({ content, expected });

test("only the listed files can be named, and none is cv.md or a system file", () => {
  assert.equal(profileFile("../AGENTS.md"), null);
  assert.equal(profileFile(undefined), null);
  for (const f of PROFILE_FILES) {
    assert.ok(!f.file.includes(".."));
    assert.notEqual(f.file, "cv.md");
    assert.notEqual(f.file, "modes/_shared.md");
  }
});

test("a save against the text that was opened goes ahead", () => {
  assert.deepEqual(decideProfileWrite(yamlSpec, disk, body("a: 2\n")), { ok: true });
  assert.deepEqual(decideProfileWrite(mdSpec, { exists: false, content: "" }, body("# new", { exists: false, content: "" })), { ok: true });
});

test("a file changed elsewhere since it was opened is never overwritten", () => {
  const r = decideProfileWrite(yamlSpec, { exists: true, content: "a: 9\n" }, body("a: 2\n"));
  assert.equal(r.status, 409);
  assert.equal(decideProfileWrite(yamlSpec, disk, { content: "a: 2\n" }).status, 409);
});

test("broken YAML is refused with the line, Markdown is not parsed", () => {
  const r = decideProfileWrite(yamlSpec, disk, body("a: 1\nb: [unclosed\n"));
  assert.equal(r.status, 422);
  assert.match(r.error, /line \d+/);
  assert.equal(decideProfileWrite(yamlSpec, disk, body("- a\n- b\n")).status, 422);
  assert.deepEqual(decideProfileWrite(mdSpec, disk, body("b: [unclosed")), { ok: true });
});

test("missing content and oversized files are refused", () => {
  assert.equal(decideProfileWrite(mdSpec, disk, { expected: disk }).status, 400);
  assert.equal(decideProfileWrite(mdSpec, disk, body("x".repeat(1_000_001))).status, 413);
});
