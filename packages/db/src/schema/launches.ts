import { sql } from "drizzle-orm";
import { type AnyPgColumn, index, integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";
import { EDITORS, base, hasRole, membersCanRead, uid } from "./_shared";
import { launchItemLevel, launchItemStatus, launchMode, launchStatus } from "./enums";
import { presets } from "./library";
import { users } from "./users";

const editor = hasRole(...EDITORS);
const manager = hasRole("owner", "admin");

/** One row per Launch click. Users edit drafts; the worker owns everything after. */
export const launches = pgTable(
  "launches",
  {
    ...base(),
    name: text("name").notNull(),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => presets.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    mode: launchMode("mode").notNull(),
    structure: jsonb("structure").notNull().default({}),
    status: launchStatus("status").notNull().default("draft"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** A step runner holds the launch until then, so two steps never overlap. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
  },
  (t) => [
    index("launches_created_idx").on(t.createdAt.desc()),
    membersCanRead(),
    pgPolicy("editors can create own drafts", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${editor} and created_by = ${uid} and status = 'draft'`,
    }),
    // A draft can be edited or queued by its author or a manager; nothing else.
    pgPolicy("authors and managers can edit drafts", {
      for: "update",
      to: authenticatedRole,
      using: sql`${editor} and status = 'draft' and (created_by = ${uid} or ${manager})`,
      withCheck: sql`${editor} and status in ('draft', 'queued') and (created_by = ${uid} or ${manager})`,
    }),
    pgPolicy("authors and managers can delete drafts", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${editor} and status = 'draft' and (created_by = ${uid} or ${manager})`,
    }),
  ],
);

const editableDraft = sql`${editor} and exists (
  select 1 from public.launches l
  where l.id = launch_id and l.status = 'draft' and (l.created_by = ${uid} or ${manager})
)`;

/** One row per object to create; the runner walks this tree. */
export const launchItems = pgTable(
  "launch_items",
  {
    ...base(),
    launchId: uuid("launch_id")
      .notNull()
      .references(() => launches.id, { onDelete: "cascade" }),
    level: launchItemLevel("level").notNull(),
    parentItemId: uuid("parent_item_id").references((): AnyPgColumn => launchItems.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().default({}),
    metaId: text("meta_id"),
    status: launchItemStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    /** Lets a retry find an object Meta already created instead of doubling it. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
  },
  (t) => [
    index("launch_items_launch_idx").on(t.launchId),
    membersCanRead(),
    pgPolicy("editors can add items to drafts", { for: "insert", to: authenticatedRole, withCheck: editableDraft }),
    pgPolicy("editors can edit items in drafts", {
      for: "update",
      to: authenticatedRole,
      using: editableDraft,
      withCheck: editableDraft,
    }),
    pgPolicy("editors can remove items from drafts", { for: "delete", to: authenticatedRole, using: editableDraft }),
  ],
);
