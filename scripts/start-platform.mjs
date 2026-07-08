import process from "node:process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function spawnNamed(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const sibling of children) {
      if (sibling !== child && !sibling.killed) {
        sibling.kill("SIGTERM");
      }
    }
    if (signal) {
      console.error(`${name} exited with signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  children.push(child);
  return child;
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const mastraBundle = join(process.cwd(), ".mastra", "output", "index.mjs");
if (!existsSync(mastraBundle)) {
  console.error(`Mastra bundle not found at ${mastraBundle}. Run npm run build:mastra first.`);
  process.exit(1);
}

spawnNamed("web", process.execPath, ["scripts/start-insightful-property-hub.mjs"], {
  HOST: process.env.HOST || "0.0.0.0",
  PORT: process.env.PORT || "3000",
});
spawnNamed("mastra", process.execPath, [mastraBundle], {
  HOST: process.env.MASTRA_HOST || process.env.HOST || "0.0.0.0",
  PORT: process.env.MASTRA_PORT || "4111",
});
