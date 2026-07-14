import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!process.env.CI) {
  run("npx", ["prisma", "dev", "--name", "health-quiz", "--detach"]);
}

let client;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const candidate = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await candidate.connect();
    client = candidate;
    break;
  } catch (error) {
    if (attempt === 19) throw error;
    await candidate.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

if (!client) throw new Error("Database did not become ready");
await client.query("DROP SCHEMA IF EXISTS public CASCADE");
await client.query("CREATE SCHEMA public");
await client.query(await readFile("prisma/migrations/20260714000000_init/migration.sql", "utf8"));
await client.end();

const child = spawn("npx", ["vitest", "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
