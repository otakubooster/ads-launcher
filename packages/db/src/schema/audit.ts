import { sql } from "drizzle-orm";
import { index, jsonb, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";
import { EDITORS, base, hasRole, isMember, membersCanRead, uid } from "./_shared";
import { changeSource, entityLevel, tableLevel } from "./enums";
import { users } from "./users";

/**
 * Append-only audit trail: UPDATE, DELETE and TRUNCATE raise an error for every
 * role, including the service role (trigger in migrations/0002).
 */
export const changeLog = pgTable(
  "change_log",
  {
    ...base(),
    /** Null for system changes made by the worker. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    source: changeSource("source").notNull(),
    entityLevel: entityLevel("entity_level").notNull(),
    /** Meta id for Meta objects, our uuid otherwise. */
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    metaResponse: jsonb("meta_response"),
  },
  (t) => [
    index("change_log_entity_idx").on(t.entityLevel, t.entityId, t.createdAt.desc()),
    index("change_log_created_idx").on(t.createdAt.desc()),
    membersCanRead(),
    pgPolicy("editors can append their own changes", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${hasRole(...EDITORS)} and actor_id = ${uid} and source in ('ui', 'claude')`,
    }),
  ],
);

/** Personal column presets and filters; each member sees only their own. */
export const savedViews = pgTable(
  "saved_views",
  {
    ...base(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: tableLevel("level").notNull(),
    columns: text("columns").array().notNull().default(sql`'{}'::text[]`),
    filters: jsonb("filters").notNull().default({}),
    sort: jsonb("sort").$type<{ id: string; desc: boolean }[]>().notNull().default([]),
  },
  (t) => [
    index("saved_views_user_idx").on(t.userId),
    pgPolicy("members manage their own views", {
      for: "all",
      to: authenticatedRole,
      using: sql`${isMember} and user_id = ${uid}`,
      withCheck: sql`${isMember} and user_id = ${uid}`,
    }),
  ],
);
