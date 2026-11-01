-- Meta leaves the response of a batched creative empty when the ad that uses it
-- depends on it; launches marked those creatives failed although their ads exist.
-- An ad that was created proves its creative exists: mark those creatives done.
UPDATE "launch_items" AS c
SET "status" = 'done', "error_code" = NULL, "error_message" = NULL
WHERE c."level" = 'creative'
  AND c."status" = 'failed'
  AND EXISTS (
    SELECT 1 FROM "launch_items" AS a
    WHERE a."parent_item_id" = c."id" AND a."level" = 'ad' AND a."status" = 'done'
  );
--> statement-breakpoint
-- Launches whose items are now all done finished fine.
UPDATE "launches" AS l
SET "status" = 'done'
WHERE l."status" IN ('partial', 'failed')
  AND NOT EXISTS (SELECT 1 FROM "launch_items" AS i WHERE i."launch_id" = l."id" AND i."status" <> 'done');
