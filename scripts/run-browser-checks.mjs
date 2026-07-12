import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const scripts = ["browser-smoke.mjs", "browser-alt-stress.mjs"];

for (const script of scripts) {
  // Same-origin storage and service-worker state must settle before the next check.
  const result = spawnSync(process.execPath, [resolve("scripts", script)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`${script} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("browser checks passed: browser-smoke, browser-alt-stress");
