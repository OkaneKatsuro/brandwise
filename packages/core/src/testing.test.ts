// What the database tests stand on (testing.ts): a schema per test file on every connection, a second core on the same data, and
// the sweep of the schemas that runs which died have left behind.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { regulatorStore } from "./regulator/store.ts";
import { dbTest, dropStaleSchemas, onSchema } from "./testing.ts";

test("the address makes the schema the whole search path, without public, and keeps the options it already has", () => {
  const plain = new URL(onSchema("postgres://user:secret@localhost:5436/marketing?sslmode=disable", "test_1800000000_ab12cd34"));
  assert.equal(plain.searchParams.get("options"), "-c search_path=test_1800000000_ab12cd34");
  assert.deepEqual([plain.host, plain.pathname, plain.username, plain.password, plain.searchParams.get("sslmode")], ["localhost:5436", "/marketing", "user", "secret", "disable"], "the rest of the address is as it was");
  const withOptions = new URL(onSchema("postgres://localhost/marketing?options=-c%20statement_timeout%3D5s", "test_1800000000_ab12cd34"));
  assert.equal(withOptions.searchParams.get("options"), "-c statement_timeout=5s -c search_path=test_1800000000_ab12cd34");
});

// The file's first database test: nothing has been written yet.
dbTest("a file's tests are on a schema of their own, on every connection: named test_<seconds>_<random>, migrated and empty", async ({ core }) => {
  // more queries at once than the pool has connections, so every connection answers
  const answers = await Promise.all(Array.from({ length: 12 }, () => core.pool.query("select current_schema() as schema, current_schemas(false)::text[] as path")));
  const [{ schema, path }] = answers[0].rows;
  assert.match(schema, /^test_\d{10}_[0-9a-f]{8}$/);
  assert.ok(Math.abs(Number(schema.split("_")[1]) - Date.now() / 1000) < 300, "the seconds are when it was made");
  assert.deepEqual(path, [schema], "public is not on the path: a table the schema does not have is not found in the instance's");
  await assert.rejects(core.pool.query("select 1 from no_such_table_of_a_test"), /does not exist/);
  assert.ok(answers.every((answer) => answer.rows[0].schema === schema));

  const named = await core.pool.query("select relnamespace::regnamespace::text as schema from pg_class where oid in ('campaign'::regclass, 'sim_clock'::regclass, 'schema_migrations'::regclass)");
  assert.deepEqual(named.rows.map((row) => row.schema), [schema, schema, schema], "a table named without a schema is the file's, whatever public has under that name");
  assert.deepEqual(await core.campaigns.list(), [], "nothing of the instance, of another file or of another run is seen");
});

dbTest("a second core reads and writes the same schema through connections of its own, the development clock included", async ({ core, secondCore }) => {
  const other = secondCore();
  assert.notEqual(other.pool, core.pool);
  const base = await core.campaigns.add({ name: "base", kind: "always_on" });
  assert.deepEqual((await other.campaigns.list()).map((campaign) => campaign.id), [base.id]);
  await regulatorStore(other.pool).setClockOffset(86_400);
  assert.equal(await regulatorStore(core.pool).clockOffset(), 86_400);
});

dbTest("test schemas made over an hour ago are those of runs that died and are dropped with all they hold; a younger one is left", async ({ core }) => {
  const now = Math.floor(Date.now() / 1000), random = randomBytes(4).toString("hex");
  const dead = `test_${now - 3660}_${random}`, young = `test_${now - 3540}_${random}`;
  const [{ own }] = (await core.pool.query("select current_schema() as own")).rows;
  const present = async () => (await core.pool.query("select nspname from pg_namespace where nspname = any($1) order by nspname", [[dead, young, own]])).rows.map((row) => row.nspname);
  await core.pool.query(`create schema ${dead}`);
  await core.pool.query(`create table ${dead}.campaign (id int)`);
  await core.pool.query(`create schema ${young}`);
  try {
    await dropStaleSchemas();
    assert.deepEqual(await present(), [young, own].sort(), "the dead one is gone; the younger one and the file's own, a moment old, are there");
  } finally {
    await core.pool.query(`drop schema ${young}`);
  }
});
