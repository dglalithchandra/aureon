CREATE TABLE "project_actuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid,
	"domain" text NOT NULL,
	"actual_weeks" integer NOT NULL,
	"actual_team_size" integer NOT NULL,
	"scope_accuracy" integer NOT NULL,
	"note" text,
	"modules" jsonb NOT NULL,
	"estimated_sprints" integer NOT NULL,
	"estimated_points" integer NOT NULL,
	"estimated_team_size" integer NOT NULL,
	"estimated_velocity" integer NOT NULL,
	"domain_multiplier" double precision DEFAULT 1 NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "share_calibration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_actuals" ADD CONSTRAINT "project_actuals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actuals" ADD CONSTRAINT "project_actuals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actuals" ADD CONSTRAINT "project_actuals_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_actuals_project_idx" ON "project_actuals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_actuals_workspace_idx" ON "project_actuals" USING btree ("workspace_id");