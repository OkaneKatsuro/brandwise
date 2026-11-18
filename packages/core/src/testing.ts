// Test helper: a database test runs on a Postgres schema that belongs to its file. The running instance keeps its tables in `public`,
// and every other test file and every other run has a schema of its own, so nothing a test writes is seen outside its file: not its
// rows, and not the development clock, which is one row per schema. S3 is not divided: objects a test stores stay in the bucket.
import { randomBytes } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import pg from "pg";
import { configFromEnv, createCore, type Core } from "./index.ts";
import { migrate } from "./migrate.ts";

/** A test schema is named `test_<unix seconds it was made at>_<random>`. Only names of this shape are ever put into a statement. */
const TEST_SCHEMA = /^test_(\d+)_[0-9a-f]+$/;
/** A run drops its schemas when it ends, so one that is still there after an hour belongs to a run that died. */
const STALE_AFTER_SECONDS = 3600;

type TestDatabase = {
  /** The file's core. Its tests share it and the rows they write: nothing is removed between them. */
  core: Core;
  /** One more core on the same data, as a second machine has it. */
  secondCore: () => Core;
};

/**
 * The address with `schema` first on the search path of every connection made from it, so no query names a schema. `public`
 * follows: extensions put their types there. Options the address already carries are kept.
 */
export function onSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", [url.searchParams.get("options"), `-c search_path=${schema},public`].filter(Boolean).join(" "));
  return url.toString();
}

/** A connection of its own, on no test schema: schemas are made and dropped from outside. */
async function connected<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Drops the test schemas that were made over an hour ago, with all they hold: what runs that died have left behind. */
export function dropStaleSchemas(): Promise<void> {
  return connected(async (client) => {
    const now = Math.floor(Date.now() / 1000);
    const { rows } = await client.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 'test\\_%'");
    for (const { nspname } of rows) {
      const madeAt = TEST_SCHEMA.exec(nspname)?.[1];
      // "if exists": another file of this run, or another run, may be dropping the same schema at this moment
      if (madeAt !== undefined && now - Number(madeAt) > STALE_AFTER_SECONDS) await client.query(`drop schema if exists ${nspname} cascade`);
    }
  });
}

// One test file is one process, so this is the file's state: its schema, and every core that was made on it.
let database: Promise<TestDatabase> | undefined;
let schema: string | undefined;
const cores: Core[] = [];

async function open(): Promise<TestDatabase> {
  await dropStaleSchemas();
  const name = `test_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString("hex")}`;
  await connected((client) => client.query(`create schema ${name}`));
  schema = name;
  const databaseUrl = onSchema(process.env.DATABASE_URL!, name);
  await migrate(databaseUrl);
  const newCore = () => {
    const core = createCore({ ...configFromEnv(), databaseUrl });
    cores.push(core);
    return core;
  };
  return { core: newCore(), secondCore: newCore };
}

/**
 * A test that needs the local stack (`pnpm infra:up`); without `DATABASE_URL` and `S3_BUCKET` it is skipped. It is given a core on
 * the file's own schema, made and migrated when the file's first test starts and dropped after its last. The schema starts empty and
 * is the file's alone, so a test names its campaigns plainly and removes nothing; tests of one file see each other's rows.
 */
export function dbTest(name: string, body: (db: TestDatabase, t: TestContext) => Promise<void>): void {
  if (!process.env.DATABASE_URL || !process.env.S3_BUCKET) {
    test.skip(name);
    return;
  }
  test(name, async (t) => body(await (database ??= open()), t));
}

// After the file's last test: close what was opened, then drop the schema. Registered here, outside any test, so that it is the
// file's hook and not the hook of the test that happened to open the database.
after(async () => {
  await Promise.all(cores.map((core) => core.close()));
  if (schema) await connected((client) => client.query(`drop schema ${schema} cascade`));
});
