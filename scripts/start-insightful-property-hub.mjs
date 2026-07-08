import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const appDir = join(process.cwd(), "insightful-property-hub");
const entry = join(appDir, ".output", "server", "index.mjs");

if (!existsSync(entry)) {
  console.error(`Frontend server entry not found at ${entry}. Run npm run build:web first.`);
  process.exit(1);
}

const env = {
  ...process.env,
  HOST: process.env.HOST || "0.0.0.0",
  PORT: process.env.PORT || "3000",
};

const child = spawn(process.execPath, [entry], {
  cwd: appDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
