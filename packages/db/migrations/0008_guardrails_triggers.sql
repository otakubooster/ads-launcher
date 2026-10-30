-- New tables need the updated_at trigger that 0002 added to the original ones.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
REVOKE ALL ON public.approval_requests, public.app_settings, public.alerts FROM anon;
--> statement-breakpoint
-- Alerts are written by the system only; members never insert or change them.
REVOKE INSERT, UPDATE, DELETE ON public.alerts FROM authenticated;
--> statement-breakpoint
-- A decision only sets these; the request itself is immutable.
REVOKE UPDATE ON public.approval_requests FROM authenticated;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, error) ON public.approval_requests TO authenticated;
