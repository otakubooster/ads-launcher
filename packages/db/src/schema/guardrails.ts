import { sql } from "drizzle-orm";
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";
import { EDITORS, base, hasRole, membersCanRead, money, uid } from "./_shared";
import { approvalKind, approvalStatus, entityLevel } from "./enums";
import { adAccounts } from "./meta";
import { users } from "./users";

const manager = hasRole("owner", "admin");

/**
 * A buyer's spend increase above the account's approval threshold waits here for
 * an owner or admin (docs/spec.md → Spend guardrails). Approving runs the change.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    ...base(),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: approvalKind("kind").notNull(),
    /** campaign / adset / ad for object changes; null for a launch. */
    entityLevel: entityLevel("entity_level"),
    /** Mirror uuid of the object, or the launch id. */
    entityId: uuid("entity_id").notNull(),
    entityName: text("entity_name").notNull(),
    /** What to apply: { status } or { dailyBudget, before }. */
    payload: jsonb("payload").$type<{ status?: "ACTIVE"; dailyBudget?: number; before?: number | null }>().notNull(),
    /** How much the account's active daily budget goes up, in minor units. */
    increase: money("increase").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("approval_requests_status_idx").on(t.status, t.createdAt.desc()),
    membersCanRead(),
    pgPolicy("editors request for themselves", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${hasRole(...EDITORS)} and requested_by = ${uid} and status = 'pending'`,
    }),
    pgPolicy("managers decide", {
      for: "update",
      to: authenticatedRole,
      using: sql`${manager} and status = 'pending'`,
      withCheck: sql`${manager} and decided_by = ${uid}`,
    }),
  ],
);

/** Workspace-wide switches, e.g. the kill switch. Only owners change them. */
export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    membersCanRead(),
    pgPolicy("owners can insert", { for: "insert", to: authenticatedRole, withCheck: hasRole("owner") }),
    pgPolicy("owners can update", { for: "update", to: authenticatedRole, using: hasRole("owner"), withCheck: hasRole("owner") }),
  ],
);

/** Alert emails sent to owners; dedupe_key stops the same alert going out twice. */
export const alerts = pgTable(
  "alerts",
  {
    ...base(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    recipients: text("recipients").array().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("alerts_created_idx").on(t.createdAt.desc()), pgPolicy("managers can read", { for: "select", to: authenticatedRole, using: manager })],
);
