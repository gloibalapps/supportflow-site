// Runs both migrations in an in-memory Postgres (PGlite). Needs: npm i -D @electric-sql/pglite. Run from the repo root.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const db = new PGlite();
await db.exec("create role anon; create role authenticated;");
await db.exec(fs.readFileSync("LICENSING-MIGRATION.sql", "utf8"));
const mig = fs.readFileSync("TRACKER-MIGRATION.sql", "utf8");
await db.exec(mig); await db.exec(mig); // re-runnable
const one = async (q, p) => (await db.query(q, p)).rows[0];
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok -", m); };
await db.query("insert into licence_payments (stripe_session_id, google_sub, product) values ('s1','u1','tracker_base'),('s2','u1','tracker_addon'),('s3','u1','tracker_full'),('s5','u1','tracker_two')");
ok(true, "licence_payments accepts tracker_base/two/addon/full");
let threw = false; try { await db.query("insert into licence_payments (stripe_session_id, google_sub, product) values ('s4','u1','tracker_sms')"); } catch { threw = true; }
ok(threw, "tracker_sms is NOT a one-off licence_payments product");
ok((await one("select tracker_sms_reset('u1','in_1',50,now(),'pi_1','ch_1') r")).r === 50, "invoice.paid grants 50");
ok((await one("select tracker_sms_reset('u1','in_1',50,now()) r")).r === 50, "same invoice again is idempotent");
ok((await one("select tracker_sms_consume('u1',2,'x') r")).r === 48, "consume 2 segments -> 48");
ok((await one("select tracker_sms_consume('u1',49,'y') r")).r === -1, "over-spend refused (-1)");
ok((await one("select balance from tracker_sms_balances where google_sub='u1'")).balance === 48, "balance unchanged after refused spend");
ok((await one("select tracker_sms_refund_usage('u1',2,'x') r")).r === 50, "provider failure gives credits back");
await db.query("select tracker_sms_consume('u1',10,'z')");
ok((await one("select tracker_sms_reset('u1','in_2',50,now()) r")).r === 50, "next period RESETS to 50 (no rollover)");
ok((await one("select count(*)::int n from tracker_sms_ledger where google_sub='u1' and kind='expire'")).n === 1, "unused texts logged as expire");
ok((await one("select tracker_sms_zero('u1','refunded','in_2') r")).r === 0, "refund zeroes balance");
ok((await one("select balance from tracker_sms_balances where google_sub='u1'")).balance === 0, "balance 0 after refund");
threw = false; try { await db.query("update tracker_sms_balances set balance=-1"); } catch { threw = true; }
ok(threw, "balance can't go negative");
const rls = (await db.query("select relname from pg_class where relname like 'tracker_%' and relkind='r' and not relrowsecurity")).rows;
ok(rls.length === 0, "RLS enabled on every tracker_* table");
