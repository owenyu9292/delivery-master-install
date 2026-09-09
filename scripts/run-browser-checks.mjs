import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Current install UI uses isolated profiles. Legacy scripts remain for old builds only.
const scripts = process.env.LEGACY_BROWSER_CHECKS === "1"
  ? ["browser-smoke.mjs", "browser-alt-stress.mjs"]
  : ["browser-field-workflow.mjs", "browser-handling.mjs"];

for (const script of scripts) {
  // Same-origin storage and service-worker state must settle before the next check.
  const result = spawnSync(process.execPath, [resolve("scripts", script)], {
    stdio: "inherit",
    env: { ...process.env, HANDLING_FULL_REGRESSION: "0" },
    windowsHide: true,
  });
  if (result.error) {
    console.error(`${script} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("browser checks passed: " + scripts.join(", "));
