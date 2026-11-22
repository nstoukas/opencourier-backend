-- Spec 0054 (row 47): the Greek interface. The four columns were generated with `prisma migrate diff`;
-- the data steps after them are written by hand. Every step is additive: no existing value is lost.

-- AlterTable: the language each person reads the apps in (AC-1, AC-2, cross check 3). Greek by default.
ALTER TABLE "User" ADD COLUMN     "language" VARCHAR(5) NOT NULL DEFAULT 'el';

-- AlterTable: an event's message as a code and its values (AC-4). Older rows keep only `message`.
ALTER TABLE "DeliveryEvent" ADD COLUMN     "messageCode" TEXT,
ADD COLUMN     "messageParams" JSONB;

-- AlterTable: the removal reasons' Greek label, and the copy a request keeps (AC-7, cross check 10).
ALTER TABLE "RemovalReason" ADD COLUMN     "labelEl" VARCHAR(60);
ALTER TABLE "DeliveryRemovalRequest" ADD COLUMN     "labelEl" VARCHAR(60);

-- Data: Greek labels for the seven default reasons (spec 0035's migration), only where the label is still
-- the default one and no Greek label is set. A Greek speaking member checks the wording before go live.
UPDATE "RemovalReason" AS r SET "labelEl" = v.label_el
FROM (VALUES
  ('removal_reason_moped_breakdown', 'Moped breakdown or accident', 'Βλάβη ή ατύχημα με το μηχανάκι'),
  ('removal_reason_restaurant_closed', 'Restaurant closed', 'Το κατάστημα είναι κλειστό'),
  ('removal_reason_food_not_ready', 'Food not ready', 'Το φαγητό δεν είναι έτοιμο'),
  ('removal_reason_unsafe_drop_off', 'Unsafe drop off', 'Μη ασφαλής παράδοση'),
  ('removal_reason_customer_unreachable', 'Customer unreachable', 'Ο πελάτης δεν απαντά'),
  ('removal_reason_personal_emergency', 'Personal emergency', 'Προσωπικό έκτακτο περιστατικό'),
  ('removal_reason_other', 'Other', 'Άλλο')
) AS v(id, label_en, label_el)
WHERE r."id" = v.id AND r."label" = v.label_en AND r."labelEl" IS NULL;

-- Data: requests already sent copy their reason's Greek label, so they read the same in both languages.
UPDATE "DeliveryRemovalRequest" AS q SET "labelEl" = r."labelEl"
FROM "RemovalReason" AS r
WHERE q."reasonId" = r."id" AND q."labelEl" IS NULL AND q."label" = r."label" AND r."labelEl" IS NOT NULL;

-- Data: the chat presets setting becomes a list of { el, en } (AC-7). The stored presets were written in
-- Greek (the defaults are Greek), so each text becomes the Greek one; the defaults get their English, any
-- other preset an empty English that the apps fill from the Greek until a representative writes it.
-- Only a stored list of texts is changed; anything else is left for the reader's own fallback.
UPDATE "Config" AS c SET "value" = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'el', e.text,
    'en', CASE e.text
      WHEN 'Περίμενε 5 λεπτά ακόμα' THEN 'Wait 5 more minutes'
      WHEN 'Άφησέ το στην πόρτα' THEN 'Leave it at the door'
      WHEN 'Πήγαινέ το πίσω στο κατάστημα' THEN 'Take it back to the restaurant'
      WHEN 'Είμαι στην πόρτα, δεν απαντούν' THEN 'I''m at the door, no answer'
      WHEN 'Το φαγητό δεν είναι έτοιμο' THEN 'The food isn''t ready'
      WHEN 'Θα αργήσω λίγο' THEN 'I''ll be a little late'
      ELSE ''
    END
  ) ORDER BY e.position), '[]'::jsonb)::text
  FROM jsonb_array_elements_text(c."value"::jsonb) WITH ORDINALITY AS e(text, position)
)
WHERE c."key" IN ('chatQuickRepliesDispatch', 'chatQuickRepliesCourier')
  AND jsonb_typeof(c."value"::jsonb) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(c."value"::jsonb) AS x(item) WHERE jsonb_typeof(x.item) <> 'string'
  );
