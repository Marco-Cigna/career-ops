/**
 * jd-archive-fill.mjs — the platform writes the report's JD archive, not the model.
 *
 * Every report must carry the posting's full text under
 * `## Job Description (archived verbatim)` (#2789). When the platform already
 * read that text before the run (jd-prefetch.mjs), having the model retype it
 * cost 1-2k output tokens per report, the most expensive tokens of the run, and
 * "verbatim" depended on the model copying faithfully. The model now writes a
 * marker line in its place and the backend substitutes the exact text before
 * the report is saved.
 *
 * A report without the marker is saved as written (the model archived the text
 * itself), so a model that ignores the instruction still produces a valid report.
 */
export const JD_ARCHIVE_MARK = "<<jd-archive>>";

const MARK_LINE = /^[ \t]*<<jd-archive>>[ \t]*$/;

/**
 * The output rule for the prompt. The marker is described mid-line, inside
 * backticks, for the same reason as the report envelope's markers: a CLI that
 * echoes its prompt must not print a line that parses as the marker.
 */
export const JD_ARCHIVE_INSTRUCTION =
  `The platform archives the posting text for you. Under \`## Job Description (archived verbatim)\`, write the \`Posted:\` line the mode asks for, then one line containing only \`${JD_ARCHIVE_MARK}\`, and nothing else in that section. Do NOT copy the posting text into the report: the platform replaces that line with the exact text before saving.`;

/**
 * Replace the first marker line with the posting text; drop any further marker
 * lines. Never touches anything else.
 *
 * @param {string} markdown - the report as the model emitted it
 * @param {string | null | undefined} jdText - the prefetched posting text
 * @returns {{ markdown: string, filled: boolean }}
 */
export function fillJdArchive(markdown, jdText) {
  if (typeof markdown !== "string" || typeof jdText !== "string" || !jdText.trim()) {
    return { markdown, filled: false };
  }
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let filled = false;
  const out = [];
  for (const line of lines) {
    if (!MARK_LINE.test(line)) { out.push(line); continue; }
    if (filled) continue;
    out.push(jdText.replace(/\r\n/g, "\n").trim().split("\n").join(eol));
    filled = true;
  }
  return { markdown: filled ? out.join(eol) : markdown, filled };
}
