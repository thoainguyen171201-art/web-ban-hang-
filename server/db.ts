import { neon } from "@neondatabase/serverless";
import { defaults, type ContentKey, type SiteContent } from "../lib/site-data.ts";

export function sql() {
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("Chưa cấu hình Neon.");
  return neon(url,{fetchOptions:{signal:AbortSignal.timeout(10_000)}});
}

export async function initialize() {
  const db=sql();
  await db.transaction([
    db`CREATE TABLE IF NOT EXISTS thoai_content (
      section text PRIMARY KEY, data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1
    )`,
    db`CREATE TABLE IF NOT EXISTS thoai_sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL)`,
    db`CREATE TABLE IF NOT EXISTS thoai_limits (key text PRIMARY KEY, started_at timestamptz NOT NULL, hits integer NOT NULL)`,
    db`CREATE TABLE IF NOT EXISTS thoai_leads (
      id text PRIMARY KEY, submission_hash text, name text NOT NULL, phone text NOT NULL, email text NOT NULL,
      company text NOT NULL, note text NOT NULL DEFAULT '', products jsonb NOT NULL, quotes jsonb NOT NULL DEFAULT '[]',
      service_ids jsonb NOT NULL, consent boolean NOT NULL,
      status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
      owner_email text NOT NULL DEFAULT 'pending', customer_email text NOT NULL DEFAULT 'pending',
      owner_email_id text, customer_email_id text, mail_claimed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    db`CREATE INDEX IF NOT EXISTS thoai_leads_created ON thoai_leads (created_at DESC,id DESC)`,
  ]);
  await db.transaction(Object.entries(defaults).map(([section,data]) =>
    db`INSERT INTO thoai_content (section,data) VALUES (${section}, ${JSON.stringify(data)}::jsonb) ON CONFLICT DO NOTHING`
  ));
}

export async function readContent() {
  const data=structuredClone(defaults);
  const revisions=Object.fromEntries(Object.keys(defaults).map(key=>[key,0])) as Record<ContentKey,number>;
  if(!process.env.DATABASE_URL)return {data,revisions};
  for(const row of await sql()`SELECT section,data,revision FROM thoai_content`) {
    if(!Object.hasOwn(defaults,row.section))continue;
    const section=row.section as ContentKey;
    Object.assign(data,{[section]:row.data as SiteContent[typeof section]});
    revisions[section]=row.revision;
  }
  for(const [page,parts] of Object.entries(defaults.pageContent)) {
    for(const [part,fields] of Object.entries(parts)) {
      data.pageContent[page]??={};
      data.pageContent[page][part]={...fields,...data.pageContent[page][part]};
    }
  }
  return {data,revisions};
}
