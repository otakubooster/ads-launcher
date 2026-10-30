import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "admin", "buyer", "viewer"]);
export type UserRole = (typeof userRole.enumValues)[number];

export const connectionStatus = pgEnum("connection_status", ["unverified", "active", "broken"]);
export const creativeKind = pgEnum("creative_kind", ["image", "video"]);
export const aspectRatio = pgEnum("aspect_ratio", ["9:16", "4:5", "1:1", "16:9"]);
export const uploadStatus = pgEnum("upload_status", ["queued", "uploading", "processing", "ready", "error"]);
export const namingLevel = pgEnum("naming_level", ["campaign", "adset", "ad"]);
export const launchMode = pgEnum("launch_mode", ["new_campaign", "existing_campaign", "existing_adset"]);
export const launchStatus = pgEnum("launch_status", ["draft", "queued", "running", "done", "partial", "failed"]);
export const launchItemLevel = pgEnum("launch_item_level", ["campaign", "adset", "creative", "ad"]);
export const launchItemStatus = pgEnum("launch_item_status", ["pending", "running", "done", "failed"]);
export const changeSource = pgEnum("change_source", ["ui", "claude", "system"]);
export const entityLevel = pgEnum("entity_level", [
  "campaign",
  "adset",
  "ad",
  "creative",
  "ad_account",
  "meta_connection",
  "preset",
  "user",
]);
export const assetKind = pgEnum("asset_kind", ["page", "instagram", "pixel"]);
export const tableLevel = pgEnum("table_level", ["campaign", "adset", "ad"]);
export const approvalKind = pgEnum("approval_kind", ["activate", "budget", "launch_activate"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "failed"]);
