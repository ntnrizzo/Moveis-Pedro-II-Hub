import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';

// Supabase CLI normally provides these schemas/roles. No application baseline
// is injected: this check detects missing historical schema migrations.
const db = new PGlite();
try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
      CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,owner uuid);`);
    const directory = new URL('../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
        try { await db.exec(await readFile(new URL(name,directory),'utf8')); }
        catch (error) {
            console.error(`Replay interrupted at ${name}: ${error.message}`);
            process.exitCode = 1;
            break;
        }
    }
} finally { await db.close(); }
