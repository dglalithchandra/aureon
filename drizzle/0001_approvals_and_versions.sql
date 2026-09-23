ALTER TABLE "approvals" ADD COLUMN "version_number" integer;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "approver_name" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "approver_email" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "approver_ip_hash" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "mode" text DEFAULT 'view' NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "version_number" integer;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "reason" text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "confidence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_version_idx" ON "approvals" USING btree ("version_id");--> statement-breakpoint
-- A version is a record of what the document was at a moment. Nothing may
-- rewrite that: the trigger refuses any UPDATE touching the content columns.
-- Approval may set locked_at, label and approved_by, and nothing else.
CREATE OR REPLACE FUNCTION versions_refuse_content_update() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.output IS DISTINCT FROM OLD.output
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'versions are immutable: % cannot be rewritten', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER versions_immutable
  BEFORE UPDATE ON "versions"
  FOR EACH ROW EXECUTE FUNCTION versions_refuse_content_update();
