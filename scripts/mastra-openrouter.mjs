import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const [command = "dev", ...restArgs] = process.argv.slice(2);

const envFilesByCommand = {
  build: [".env", ".env.local", ".env.development"],
  dev: [".env", ".env.local", ".env.development"],
  start: [".env", ".env.local", ".env.production"],
  studio: [".env", ".env.local", ".env.development"],
};

for (const file of envFilesByCommand[command] || [".env", ".env.local"]) {
  const fullPath = join(cwd, file);
  if (existsSync(fullPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(fullPath);
  }
}

if (process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENROUTER_API_KEY;
}

if (!process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL =
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
}

function resolveMastraCli() {
  const directPath = join(cwd, "node_modules", "mastra", "dist", "index.js");
  if (existsSync(directPath)) {
    return directPath;
  }

  const pnpmDir = join(cwd, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    throw new Error("Mastra CLI not found: node_modules/.pnpm is missing");
  }

  const candidates = readdirSync(pnpmDir)
    .filter(name => name.startsWith("mastra@"))
    .map(name => join(pnpmDir, name, "node_modules", "mastra", "dist", "index.js"))
    .filter(existsSync);

  if (candidates.length === 0) {
    throw new Error("Mastra CLI not found in node_modules/.pnpm");
  }

  return candidates[0];
}

const child = spawn(process.execPath, [resolveMastraCli(), command, ...restArgs], {
  cwd,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", code => {
  process.exit(code ?? 0);
});
