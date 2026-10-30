import { sql } from "drizzle-orm";
import { check, integer, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";
import { base, hasRole, membersCanRead, uid } from "./_shared";
import { userRole } from "./enums";

// Admins manage the team but can never create, edit or remove an owner.
const canManage = sql`(${hasRole("owner")} or (${hasRole("admin")} and role <> 'owner'))`;

export const users = pgTable(
  "users",
  {
    ...base(),
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: userRole("role").notNull().default("viewer"),
    /** Largest budget change a buyer may make in one edit. */
    maxBudgetChangePct: integer("max_budget_change_pct").notNull().default(30),
  },
  () => [
    check("users_max_budget_change_pct", sql`max_budget_change_pct between 1 and 100`),
    membersCanRead(),
    pgPolicy("managers can insert", { for: "insert", to: authenticatedRole, withCheck: canManage }),
    pgPolicy("managers can update", { for: "update", to: authenticatedRole, using: canManage, withCheck: canManage }),
    pgPolicy("managers can delete others", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${canManage} and id <> ${uid}`,
    }),
  ],
);
