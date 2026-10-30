-- Helpers used by RLS policies, triggers and views. Created before the tables,
-- so the role helpers are plpgsql (bodies are resolved at call time).

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- The signed-in member's role, or null when the user has no row in public.users.
-- SECURITY DEFINER so policies on public.users never recurse into themselves.
CREATE OR REPLACE FUNCTION app.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT u.role::text FROM public.users u WHERE u.id = auth.uid());
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.has_role(VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(app.current_user_role() = ANY (roles), false);
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.safe_div(numerator numeric, denominator numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT numerator / nullif(denominator, 0);
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.forbid_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
