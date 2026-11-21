-- Spec 0044 (AC-7, cross check 8): the fairness matcher becomes the default. Operator decision,
-- 2026-11-20 (docs/decisions/2026-11-20-architect-batch.md, row 12). Data only, no schema change.
-- Only an instance on Nearest or Seniority moves; one an admin set to Static (or already Fairness) keeps
-- its choice. The change is written to the settings record first, with no admin (changedByUserId NULL),
-- so members see it on the What changed list like any representative's save.
INSERT INTO "SettingChange" ("id", "key", "oldValue", "newValue", "createdAt", "changedByUserId")
SELECT 'fairness-default-2026-11-20', 'courierMatcherType', to_jsonb("value"), to_jsonb('FAIRNESS'::text), CURRENT_TIMESTAMP, NULL
FROM "Config"
WHERE "key" = 'courierMatcherType' AND "value" IN ('NEAREST_COURIER', 'COURIER_SENIORITY');

UPDATE "Config" SET "value" = 'FAIRNESS'
WHERE "key" = 'courierMatcherType' AND "value" IN ('NEAREST_COURIER', 'COURIER_SENIORITY');
