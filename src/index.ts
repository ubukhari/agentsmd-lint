/**
 * agentsmd-lint — lint AGENTS.md / CLAUDE.md / .cursorrules against the repo
 * they describe. Deterministic, offline, no LLM, no telemetry.
 */
export type {
  Finding,
  Grade,
  LintOptions,
  RepoReader,
  Report,
  RuleId,
  Score,
  ScoreBreakdownItem,
  Severity,
} from "./types.js";
export { DEFAULT_INSTRUCTION_FILES, VERSION, findInstructionFiles, lint, lintDir } from "./lint.js";
export { fsReader, lazyReader, memoryReader, normalizePath, IGNORED_DIRS } from "./reader.js";
export { collectRepoFacts, parseJustRecipes, parseMakeTargets } from "./repo.js";
export type { PackageInfo, RepoFacts } from "./repo.js";
export {
  extractCodeSpans,
  extractCommands,
  extractNodeVersions,
  extractPaths,
  extractToolMentions,
  parseCommandLine,
  pathCandidate,
} from "./parse.js";
export type { CodeSpan, CommandRef, Manager, NodeVersionRef, PathRef } from "./parse.js";
export {
  ALL_RULES,
  checkContradictions,
  checkDeadPaths,
  checkSections,
  checkStaleCommands,
} from "./rules.js";
export type { InstructionFile, RuleContext } from "./rules.js";
export { RULE_WEIGHTS, gradeFor, scoreFindings, statusFor } from "./score.js";
export {
  BADGE_LABEL,
  DEFAULT_BADGE_URL_BASE,
  badgeMessage,
  badgeUrl,
  renderReadinessBadge,
} from "./badge.js";
export type { ReadinessBadgeOptions } from "./badge.js";
export {
  COMMENT_MARKER,
  FOOTER_LINE,
  formatGithub,
  formatJson,
  formatMarkdown,
  formatReport,
  formatText,
} from "./format.js";
export type { Format, MarkdownOptions } from "./format.js";
export { createWebhookHandler, githubReader, pemToPkcs8Der, signAppJwt } from "./github/webhook.js";
export type { GithubAppConfig, WebhookResult } from "./github/webhook.js";
