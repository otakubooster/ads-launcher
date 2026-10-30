-- New tables need the updated_at trigger that 0002 added to the original ones.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_assets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
REVOKE ALL ON public.meta_assets FROM anon;
