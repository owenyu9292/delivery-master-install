import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const stagedOnly = args.has("--staged");
const expectedRootNames = new Set(["delivery-master-install-deploy"]);
const forbiddenPathPattern = /OneDrive|Downloads|Desktop|\.codex-remote-attachments/i;
const secretPattern = /(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*[^\s]{8,}|authorization:\s*bearer\s+[A-Za-z0-9._-]{20,}|bearer\s+[A-Za-z0-9._-]{20,}/i;
const textLikePattern = /\.(md|txt|json|ts|tsx|js|mjs|cjs|css|html|svg|webmanifest|yml|yaml|ps1|sh)$/i;

function git(args, options = {}) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function fail(message) {
  console.error(`[codex-hook] BLOCK: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[codex-hook] ${message}`);
}

const root = git(["rev-parse", "--show-toplevel"]);
const normalizedRoot = root.replaceAll("\\", "/");

if (forbiddenPathPattern.test(root)) {
  fail(`repository path is forbidden: ${root}`);
}

if (!expectedRootNames.has(path.basename(normalizedRoot))) {
  fail(`expected source repo folder '${[...expectedRootNames].join("' or '")}', got: ${root}`);
}

if (!existsSync(path.join(root, "instruction.md")) || !existsSync(path.join(root, "progress.md")) || !existsSync(path.join(root, "changelog.md"))) {
  fail("instruction.md, progress.md, and changelog.md must exist in the development source repo.");
}

const diffArgs = stagedOnly
  ? ["diff", "--cached", "--name-only"]
  : ["diff", "--name-only"];
const changed = git(diffArgs)
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

if (changed.length === 0) {
  info("no changed files to check.");
  process.exit(0);
}

info("changed files:");
for (const file of changed) {
  console.log(`  ${file}`);
}

const forbiddenChanged = changed.find((file) =>
  /(^|\/)(dist|backup|backups|server_copy|server_edit)(\/|$)/i.test(file) ||
  forbiddenPathPattern.test(file)
);
if (forbiddenChanged) {
  fail(`staged path should not be committed from source repo: ${forbiddenChanged}`);
}

const sourceOrToolChanged = changed.some((file) =>
  /^(src|public|scripts|test)\//.test(file) ||
  /^(package\.json|package-lock\.json|tsconfig\.json)$/.test(file)
);

const requiresChangelog = changed.some((file) =>
  /\.md$/i.test(file) || sourceOrToolChanged
);

if (requiresChangelog && !changed.includes("changelog.md")) {
  fail("source, script, test, package, or markdown changed but changelog.md was not staged.");
}

if (sourceOrToolChanged && !changed.includes("progress.md")) {
  fail("source, script, test, or package changed but progress.md was not staged.");
}

if (sourceOrToolChanged && !changed.includes("todo.md") && !changed.includes("unresolved.md")) {
  info("follow-up ledger note: review whether todo.md or unresolved.md needs an update.");
}

if (changed.includes("progress.md")) {
  info("progress.md included.");
}

if (changed.includes("changelog.md")) {
  info("changelog.md included.");
}

for (const file of changed) {
  if (!textLikePattern.test(file)) continue;
  let content = "";
  try {
    content = stagedOnly
      ? git(["show", `:${file}`])
      : execFileSync("node", ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(root, file))}, 'utf8'))`], { encoding: "utf8" });
  } catch {
    continue;
  }
  if (secretPattern.test(content)) {
    fail(`possible secret pattern found in ${file}`);
  }
}

git(stagedOnly ? ["diff", "--cached", "--check"] : ["diff", "--check"], { stdio: "inherit" });
info("pre-commit checks passed.");
