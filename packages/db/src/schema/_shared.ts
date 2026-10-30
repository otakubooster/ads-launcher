import { sql, type SQL } from "drizzle-orm";
import { bigint, pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";
import type { UserRole } from "./enums";

/**
 * Every table has id, created_at and updated_at (updated_at is kept by a trigger).
 * A function, because Drizzle column builders must not be shared between tables.
 */
export const base = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Money in the account currency's minor unit (cents). */
export const money = (name: string) => bigint(name, { mode: "number" });

export const uid = authUid;

// Role checks run through SECURITY DEFINER helpers in the `app` schema
// (migrations/0000_app_functions.sql) so policies never recurse into `users`.
// Wrapped in (select …) so Postgres evaluates them once per statement, not per row.
export const isMember = sql`(select app.current_user_role()) is not null`;

export function hasRole(...roles: UserRole[]): SQL {
  return sql.raw(`(select app.has_role(${roles.map((r) => `'${r}'`).join(", ")}))`);
}

export const EDITORS: UserRole[] = ["owner", "admin", "buyer"];
export const MANAGERS: UserRole[] = ["owner", "admin"];

export function membersCanRead() {
  return pgPolicy("members can read", { for: "select", to: authenticatedRole, using: isMember });
}

/** Insert, update and delete for the given roles; reads come from membersCanRead(). */
export function rolesCanWrite(label: string, roles: UserRole[]) {
  const allowed = hasRole(...roles);
  return [
    pgPolicy(`${label} can insert`, { for: "insert", to: authenticatedRole, withCheck: allowed }),
    pgPolicy(`${label} can update`, { for: "update", to: authenticatedRole, using: allowed, withCheck: allowed }),
    pgPolicy(`${label} can delete`, { for: "delete", to: authenticatedRole, using: allowed }),
  ];
}
