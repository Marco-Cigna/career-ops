/**
 * tools-catalog.mjs — the career-ops commands the dashboard had no button for.
 *
 * Two closed lists, shared by the Tools page and the routes behind it, so the
 * server never runs a script or a mode the page did not offer:
 *
 *   SCRIPT_TOOLS  core scripts that take no input and cost no tokens. The
 *                 script name and its arguments are fixed here; a request only
 *                 names an id.
 *   AGENT_MODES   modes that need an agent and something to work on (a company,
 *                 a posting, an offer letter). They run as a read-only worker
 *                 whose result is the run log: it saves no file.
 */

/**
 * @typedef {{id: string, label: string, description: string, script: string, args: string[], group: "Reports"|"Health"|"Maintenance", writes?: boolean, slow?: boolean}} ScriptTool
 * @type {readonly ScriptTool[]}
 */
export const SCRIPT_TOOLS = Object.freeze([
  { id: "stats", group: "Reports", label: "Lifetime stats", description: "Tracker roll-up, funnel, scan totals and follow-up compliance.", script: "stats", args: ["--summary"] },
  { id: "funnel", group: "Reports", label: "Funnel and speed", description: "Your funnel against market benchmarks, and how long each stage takes.", script: "funnel-velocity", args: ["--summary"] },
  { id: "closing", group: "Reports", label: "Closing soon", description: "Evaluated roles whose closing date falls in the next 7 days.", script: "closing-soon", args: ["--summary"] },
  { id: "reeval", group: "Reports", label: "Stale evaluations", description: "Roles scored before your CV or profile last changed.", script: "reeval-candidates", args: ["--summary"] },
  { id: "reposts", group: "Reports", label: "Reposted roles", description: "Roles re-listed two or more times in 90 days.", script: "detect-reposts", args: ["--summary"] },
  { id: "salary", group: "Reports", label: "Salary gap", description: "Your target pay against what postings advertise.", script: "salary-gap", args: ["--summary"] },
  { id: "discards", group: "Reports", label: "What the gates skipped", description: "Postings the pre-screen and triage dropped, by reason.", script: "discard-analytics", args: [] },
  { id: "filters", group: "Reports", label: "Title filter audit", description: "Scanner keywords that never match, are redundant, or bring in low scores.", script: "filter-audit", args: ["--summary"] },
  { id: "silence", group: "Reports", label: "Silent after interview", description: "Companies that went quiet after an interview round.", script: "rejection-latency", args: ["--summary"] },
  { id: "health", group: "Health", label: "Pipeline health check", description: "Checks the tracker, reports and links for inconsistencies.", script: "verify-pipeline", args: [] },
  { id: "doctor", group: "Health", label: "Setup check", description: "Checks that career-ops and its tools are installed correctly.", script: "doctor", args: [] },
  { id: "jd-archive", group: "Health", label: "Archived postings", description: "Reports that are missing their saved job description.", script: "check-jd-archive", args: ["--summary"] },
  { id: "portal-audit", group: "Health", label: "Board content audit", description: "Reads every watched board and flags empty or suspicious ones. Takes a few minutes.", script: "audit-portals", args: ["--summary"], slow: true },
  { id: "merge", group: "Maintenance", label: "Merge tracker additions", description: "Merges pending evaluation rows into the tracker.", script: "merge-tracker", args: [], writes: true },
  { id: "dedup", group: "Maintenance", label: "Remove duplicate rows", description: "Folds duplicate tracker rows for the same role into one.", script: "dedup-tracker", args: [], writes: true },
  { id: "normalize", group: "Maintenance", label: "Normalise statuses", description: "Rewrites non-standard statuses to the canonical ones.", script: "normalize-statuses", args: [], writes: true },
]);

/**
 * @typedef {{id: string, label: string, description: string, file: string, inputLabel: string, placeholder: string}} AgentMode
 * @type {readonly AgentMode[]}
 */
export const AGENT_MODES = Object.freeze([
  { id: "deep", label: "Company research", description: "A six-part brief on a company: strategy, recent moves, engineering culture, challenges, competitors, your angle.", file: "modes/deep.md", inputLabel: "Company (and role, if you have one)", placeholder: "Atlassian — Data Engineer" },
  { id: "contacto", label: "LinkedIn outreach", description: "Finds who to contact at a company and drafts a connection message. Draft only.", file: "modes/contacto.md", inputLabel: "Company and role, or a report number", placeholder: "#22, or Later — Senior AI Automation Engineer" },
  { id: "email", label: "Application email", description: "Drafts a formal application email with subject, body and attachment list. Never sends.", file: "modes/email.md", inputLabel: "Report number or posting", placeholder: "#22" },
  { id: "interview-prep", label: "Interview prep", description: "Company-specific interview intelligence and the stories to prepare.", file: "modes/interview-prep.md", inputLabel: "Company and role, or a report number", placeholder: "#22" },
  { id: "interview-redflag", label: "Red-flag check", description: "Checks whether a company looks safe to join before you commit.", file: "modes/interview-redflag.md", inputLabel: "Company", placeholder: "Acme Pty Ltd" },
  { id: "offer-prep", label: "Understand an offer", description: "Walks through an offer or contract clause by clause and lists questions for a lawyer. Describes, never judges.", file: "modes/offer-prep.md", inputLabel: "Paste the offer or contract text", placeholder: "Paste the full text here" },
  { id: "ofertas", label: "Compare roles", description: "Ranks several evaluated roles against each other.", file: "modes/ofertas.md", inputLabel: "Report numbers to compare", placeholder: "#7, #21, #22" },
  { id: "titles", label: "Adjacent job titles", description: "Suggests other titles worth searching, from your CV.", file: "modes/titles.md", inputLabel: "Anything to steer it (optional)", placeholder: "Focus on data and automation" },
  { id: "training", label: "Course or certificate", description: "Is this course worth your time for the roles you want?", file: "modes/training.md", inputLabel: "Course or certificate", placeholder: "dbt Fundamentals" },
  { id: "project", label: "Portfolio project idea", description: "Is this project worth building for your search?", file: "modes/project.md", inputLabel: "Project idea", placeholder: "An ETL pipeline for public energy-market data" },
  { id: "calibrate", label: "Score calibration", description: "Do your scores predict your real outcomes? Advisory only.", file: "modes/calibrate.md", inputLabel: "Anything to focus on (optional)", placeholder: "" },
  { id: "patterns", label: "Rejection patterns", description: "What your outcomes say about where to aim.", file: "modes/patterns.md", inputLabel: "Anything to focus on (optional)", placeholder: "" },
  { id: "text", label: "Tailored CV as text", description: "A tailored CV in Markdown, to paste into your own template.", file: "modes/text.md", inputLabel: "Report number", placeholder: "#22" },
]);

/** @param {unknown} id */
export function scriptTool(id) {
  return SCRIPT_TOOLS.find((tool) => tool.id === id) ?? null;
}

/** @param {unknown} id */
export function agentMode(id) {
  return AGENT_MODES.find((mode) => mode.id === id) ?? null;
}

/** Terminal colour codes mean nothing in a web page. */
export function plainOutput(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r\n/g, "\n").slice(0, 200_000);
}
