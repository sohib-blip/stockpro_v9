#!/usr/bin/env node
// Summarises an ESLint JSON report (eslint . -f json -o <file>) for CI.
//
// Usage: node scripts/lint-report.mjs <eslint-report.json>
//
// Without LINT_MAX_PROBLEMS the report is informational and always exits 0.
// With LINT_MAX_PROBLEMS=<n> it exits 1 when the total number of problems
// (errors + warnings) is above <n>: a ceiling that stops new lint problems
// while the existing ones are cleaned up, to be lowered as the count drops.
import { appendFileSync, readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node scripts/lint-report.mjs <eslint-report.json>");
  process.exit(2);
}

let results;
try {
  results = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  // Without a ceiling the lint stays informational, even when ESLint crashed.
  const level = process.env.LINT_MAX_PROBLEMS?.trim() ? "error" : "warning";
  console.log(`::${level}::Could not read ESLint report ${reportPath}: ${error.message}`);
  process.exit(level === "error" ? 1 : 0);
}

let errors = 0;
let warnings = 0;
let fatal = 0;
const byRule = new Map();
const filesWithProblems = new Set();

for (const file of results) {
  errors += file.errorCount;
  warnings += file.warningCount;
  fatal += file.fatalErrorCount ?? 0;
  for (const message of file.messages) {
    const rule = message.ruleId ?? (message.fatal ? "parse error" : "other");
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    filesWithProblems.add(file.filePath);
  }
}

const total = errors + warnings;
const rawMax = process.env.LINT_MAX_PROBLEMS?.trim();
const max = rawMax ? Number(rawMax) : null;
if (max !== null && !Number.isInteger(max)) {
  console.error(`::error::LINT_MAX_PROBLEMS must be a whole number, got "${rawMax}"`);
  process.exit(2);
}

const topRules = [...byRule.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const headline = `Lint: ${total} problem(s) (${errors} error(s), ${warnings} warning(s)) in ${filesWithProblems.size} file(s)`;

console.log(headline);
for (const [rule, count] of topRules) console.log(`  ${String(count).padStart(5)}  ${rule}`);

const overCeiling = max !== null && total > max;
const status =
  max === null
    ? "Informational only (no ceiling set)."
    : overCeiling
      ? `Above the ceiling of ${max}: fix the new problems or justify raising LINT_MAX_PROBLEMS.`
      : `Within the ceiling of ${max}.`;

if (total > 0 || fatal > 0) {
  const level = overCeiling ? "error" : "warning";
  console.log(`::${level}::${headline}. ${status}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### ${headline}`,
    "",
    status,
    "",
    "| Count | Rule |",
    "|---:|---|",
    ...topRules.map(([rule, count]) => `| ${count} | \`${rule}\` |`),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

process.exit(overCeiling ? 1 : 0);
