-- Stand-in for the parts of Supabase the migrations rely on: the auth schema,
-- auth.uid(), the anon / authenticated / service_role roles and Supabase's
-- default grants. Used by the tests (PGlite) and for plain local Postgres.
-- Never run this against a Supabase project; it already has all of it.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email varchar(255)
);

-- Same resolution order as Supabase.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

DO $$
BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
