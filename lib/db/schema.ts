import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The database. One Postgres, three groups of tables:
 *
 *   identity   users, accounts, auth_sessions, verification_tokens — the
 *              shape @auth/drizzle-adapter expects, so Auth.js stores its
 *              own rows next to everything else instead of in a second
 *              system.
 *   the work   workspaces, workspace_members, projects, rounds, shares,
 *              versions, approvals.
 *   the record llm_usage, audit_log.
 *
 * Redis keeps only what is allowed to vanish: locks, rate limits, caches and
 * live job progress. Anything a user would miss lives here.
 *
 * JSONB is used where the shape is already a validated Zod document
 * (extraction, final output). Those columns are re-parsed on read, so a
 * document written by an older schema version is rejected rather than
 * trusted — the same rule the Redis store followed.
 */

/* ──────────────────────────────────────────────────────────────
 *  Identity (Auth.js)
 * ────────────────────────────────────────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** One row per linked provider (Google today, more later). */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

/**
 * Auth.js sessions — the browser's login, not a scoping session. Named
 * `auth_sessions` because "session" means something else in this codebase.
 */
export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

/** Magic-link tokens. */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/* ──────────────────────────────────────────────────────────────
 *  Workspaces
 * ────────────────────────────────────────────────────────────── */

/** Days of retention for raw client input; outputs are always kept. */
export const DEFAULT_RAW_INPUT_RETENTION_DAYS = 90;

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /**
   * Raw client input older than this many days is blanked by the retention
   * job. 0 disables the deletion. The generated documents stay either way.
   */
  rawInputRetentionDays: integer("raw_input_retention_days")
    .notNull()
    .default(DEFAULT_RAW_INPUT_RETENTION_DAYS),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const WORKSPACE_ROLES = ["owner", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** owner | editor | viewer — checked by lib/auth/access.ts. */
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

/* ──────────────────────────────────────────────────────────────
 *  Projects — what used to be a "session" in Redis
 * ────────────────────────────────────────────────────────────── */

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull().default("Untitled scope"),
    /** The client's own words. Blanked by the retention job, never the output. */
    rawInput: text("raw_input").notNull(),
    enrichedInput: text("enriched_input").notNull().default(""),
    status: text("status").notNull(),
    pipelineStage: text("pipeline_stage"),
    confidence: integer("confidence").notNull().default(0),
    finalOutput: jsonb("final_output"),
    draftOutput: jsonb("draft_output"),
    lastError: jsonb("last_error"),
    /** Set once the retention job has blanked rawInput. */
    rawInputDeletedAt: timestamp("raw_input_deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** The signed-in owner, once there is one. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    /**
     * The anonymous browser that created it (BUG-03). Kept after sign-in so
     * the claim is auditable, and so an anonymous browser that never signs
     * in still reaches its own project.
     */
    anonOwnerId: uuid("anon_owner_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("projects_user_idx").on(table.userId),
    index("projects_workspace_idx").on(table.workspaceId),
    index("projects_anon_owner_idx").on(table.anonOwnerId),
    index("projects_updated_idx").on(table.updatedAt),
  ],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    extraction: jsonb("extraction").notNull(),
    githubEnrichment: jsonb("github_enrichment"),
    questions: jsonb("questions").notNull().default([]),
    answers: jsonb("answers").notNull().default([]),
    addedDescription: text("added_description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rounds_project_number_idx").on(table.projectId, table.roundNumber),
  ],
);

/**
 * A share link: a snapshot of the output taken when it was shared (BUG-04),
 * so the link keeps working and later edits appear only after re-sharing.
 */
export const shares = pgTable(
  "shares",
  {
    token: text("token").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The anonymous owner at the time of sharing; null once signed in. */
    anonOwnerId: uuid("anon_owner_id"),
    title: text("title").notNull(),
    finalOutput: jsonb("final_output").notNull(),
    /** Only the newest share of a project is the "active" one. */
    active: boolean("active").notNull().default(true),
    /**
     * view     read-only, what a share link has always been
     * approval the same document plus Approve / Request changes
     */
    mode: text("mode").notNull().default("view"),
    /** The version being approved, for an approval link. */
    versionId: uuid("version_id").references(() => versions.id, {
      onDelete: "set null",
    }),
    versionNumber: integer("version_number"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("shares_project_idx").on(table.projectId),
    index("shares_expires_idx").on(table.expiresAt),
  ],
);

/* ──────────────────────────────────────────────────────────────
 *  Versions and approvals (blueprint steps 13 and 14)
 * ────────────────────────────────────────────────────────────── */

/** Why a version exists. */
export const VERSION_REASONS = ["generated", "edited", "clarified"] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

/**
 * One immutable snapshot of a project's output.
 *
 * Immutable is enforced by the database, not only by convention: a trigger
 * (see the migration) refuses any UPDATE that changes the content columns.
 * Approval may set `lockedAt`, `label` and `approvedBy`, and nothing else.
 */
export const versions = pgTable(
  "versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    /** The whole FinalOutput as it stood; diffed against its predecessor. */
    output: jsonb("output").notNull(),
    /** generated | edited | clarified */
    reason: text("reason").notNull().default("generated"),
    /** The computed confidence at the time (ARCH-01). */
    confidence: integer("confidence").notNull().default(0),
    label: text("label"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Set when a client approves it: the version can never change after. */
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    /** The name the approver gave, for the "Approved v3 — date" label. */
    approvedBy: text("approved_by"),
  },
  (table) => [
    uniqueIndex("versions_project_number_idx").on(table.projectId, table.versionNumber),
  ],
);

export const APPROVAL_STATES = ["pending", "approved", "changes_requested"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/**
 * A client's decision on one version. The client needs no account, so the
 * identity kept is what they typed plus a hash of their IP — enough to show
 * who approved and to tell two approvals apart, without storing an address.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => versions.id, { onDelete: "cascade" }),
    /** The number shown to the client, kept even if the version row goes. */
    versionNumber: integer("version_number"),
    /** pending | approved | changes_requested */
    state: text("state").notNull().default("pending"),
    comment: text("comment"),
    approverName: text("approver_name"),
    approverEmail: text("approver_email"),
    /** SHA-256 of the client's IP. Never the address itself. */
    approverIpHash: text("approver_ip_hash"),
    /** The share link the decision came through. */
    shareToken: text("share_token"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("approvals_project_idx").on(table.projectId),
    index("approvals_version_idx").on(table.versionId),
  ],
);

/* ──────────────────────────────────────────────────────────────
 *  The record
 * ────────────────────────────────────────────────────────────── */

/** One row per model call (step 24): what it was for, and what it cost. */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    /** extract | mcq | finalize.client | finalize.engineer | extract_modules */
    label: text("label").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    /** Micro-dollars, so the sum stays exact without a float. */
    costMicros: integer("cost_micros").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("llm_usage_project_idx").on(table.projectId),
    index("llm_usage_created_idx").on(table.createdAt),
  ],
);

/** Who did what to which row. Append-only; never updated. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** project.delete, share.revoke, retention.raw_input_deleted, … */
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** The anonymous browser, when there was no signed-in user. */
    actorAnonId: uuid("actor_anon_id"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_subject_idx").on(table.subjectType, table.subjectId),
    index("audit_log_created_idx").on(table.createdAt),
  ],
);

export const SHARE_MODES = ["view", "approval"] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

/** Expiry choices offered when a link is made (blueprint step 13). */
export const SHARE_EXPIRY_DAYS = [7, 30, 90] as const;
export type ShareExpiryDays = (typeof SHARE_EXPIRY_DAYS)[number];

export const schema = {
  users,
  accounts,
  authSessions,
  verificationTokens,
  workspaces,
  workspaceMembers,
  projects,
  rounds,
  shares,
  versions,
  approvals,
  llmUsage,
  auditLog,
};
