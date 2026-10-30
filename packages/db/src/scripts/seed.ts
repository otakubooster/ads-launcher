import { createDb } from "../client";
import { seed } from "../seed";

// Refuse anything that is not obviously a local database unless forced.
const url = process.env.DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
if (!local && !process.argv.includes("--force")) {
  console.error("Refusing to seed a non-local database. Re-run with --force if you are sure.");
  process.exit(1);
}

const db = createDb(url);
try {
  const result = await seed(db, { minimal: process.argv.includes("--minimal") });
  console.log(`Seeded ${result.ads} ads and ${result.insights} insight rows.`);
} finally {
  await db.$client.end();
}
