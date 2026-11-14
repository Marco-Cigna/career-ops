#!/usr/bin/env node
/**
 * lib/profile-compact.mjs — config/profile.yml as data, without its commentary.
 *
 * The shipped profile template is mostly comments: on a real profile 25k
 * characters, of which about 4.5k are values. Evaluation workers get the profile
 * in their prompt (batch-runner.sh's runtime personalization, the web's context
 * pack), so every comment line is paid for on every turn of every evaluation.
 * Parsing and re-dumping keeps every value and drops the rest.
 *
 * The web keeps a copy of compactProfileYaml in web/src/lib/eval-context-pack.mjs
 * (its bundler cannot import from the checkout root); a web test holds the two equal.
 *
 *   node lib/profile-compact.mjs <profile.yml>    prints the compact YAML
 *
 * Unparseable YAML is printed unchanged: the worker still gets the file, and the
 * YAML error stays visible instead of a silently dropped profile.
 */
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { isMainModule } from './is-main-module.mjs';

/** @param {string} text */
export function compactProfileYaml(text) {
  try {
    const doc = yaml.load(text);
    if (!doc || typeof doc !== 'object') return text;
    return yaml.dump(doc, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();
  } catch {
    return text;
  }
}

if (isMainModule(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node lib/profile-compact.mjs <profile.yml>');
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`profile-compact: cannot read ${file}: ${err.message}`);
    process.exit(1);
  }
  process.stdout.write(`${compactProfileYaml(text)}\n`);
}
