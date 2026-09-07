// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE public.tenants(id text PRIMARY KEY); CREATE TABLE public.ai_generations(id text PRIMARY KEY);`);
 const baseline = await readFile(new URL('../supabase/migrations/20260720011303_pondbridge_native_baseline.sql', import.meta.url),'utf8');
 for(const table of ['email_broadcasts','analytics_events','resend_webhook_events','email_suppressions']) {
  const start=baseline.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  const ddl=baseline.slice(start,baseline.indexOf('\n);',start)+3).replaceAll("encode(gen_random_bytes(12), 'hex')","gen_random_uuid()::text");
  await db.exec(ddl);
 }
 await db.exec(await readFile(new URL('../supabase/migrations/20260907121221_atomic_resend_webhook_processing.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../apps/api/tests/resendWebhookAtomicity.sql',import.meta.url),'utf8'));
 console.log('PASS: SQL transaction rollback, redelivery, duplicate suppression, cross-tenant broadcast isolation, unknown-tenant suppression, RPC grants (PGlite).');
} finally { await db.close(); }
