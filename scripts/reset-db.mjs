import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("DROP SCHEMA IF EXISTS public CASCADE");
await client.query("CREATE SCHEMA public");
await client.query(await readFile("prisma/migrations/20260714000000_init/migration.sql", "utf8"));
await client.end();
console.log("Local database reset and migrated.");
