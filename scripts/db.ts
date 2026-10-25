/**
 * Database helper for Supabase (or any Postgres).
 *   pnpm db:push      apply supabase/migrations/*.sql in order, skipping ones already applied
 *   pnpm db:seed      run supabase/seed.sql (safe to rerun)
 * Needs DATABASE_URL in .env: Supabase dashboard → Connect → Session pooler connection string.
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(import.meta.dirname, "..", "supabase");
const command = process.argv[2];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env (Supabase dashboard → Connect → Session pooler).");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
// Supabase requires TLS. Certificate verification is off so this works without downloading Supabase's CA;
// acceptable for a dev-only script, but don't reuse this setting in the server.
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: isLocal ? false : { rejectUnauthorized: false } });

async function push() {
  await client.query(`
    create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now());
    alter table schema_migrations enable row level security;
  `);
  const applied = new Set((await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(join(ROOT, "migrations"))).filter((f) => f.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(ROOT, "migrations", file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`apply ${file}`);
      count++;
    } catch (err) {
      await client.query("rollback");
      throw new Error(`${file} failed, nothing from it was applied: ${(err as Error).message}`);
    }
  }
  console.log(count ? `Applied ${count} migration(s).` : "Database is up to date.");
}

async function seed() {
  await client.query(await readFile(join(ROOT, "seed.sql"), "utf8"));
  console.log("Seeded.");
}

const commands: Record<string, () => Promise<void>> = { push, seed };
if (!commands[command]) {
  console.error("Usage: tsx scripts/db.ts <push|seed>");
  process.exit(1);
}

try {
  await client.connect();
  await commands[command]();
} catch (err) {
  console.error((err as Error).message);
  if ((err as NodeJS.ErrnoException).code === "ENOTFOUND" && /@db\.[a-z0-9]+\.supabase\.co/.test(url)) {
    console.error(
      "\nThat's Supabase's direct connection host, which is IPv6-only and doesn't resolve on many networks.\n" +
        "Use the Session pooler string instead: Supabase dashboard → Connect → Session pooler.",
    );
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
