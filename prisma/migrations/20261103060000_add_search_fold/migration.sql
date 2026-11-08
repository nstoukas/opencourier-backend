-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "searchFold" TEXT;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "searchFold" TEXT;


-- Spec 0025 (row 98): the admin search folds Greek and Latin case and accents, and every sigma to σ.
-- The FROM list starts with the Greek and accented capitals, so the fold does not depend on the
-- server's locale (under a C locale lower() folds ASCII only). src/rest-api/common/search-fold.ts
-- holds the same two strings; a test compares them with this file.
CREATE OR REPLACE FUNCTION oc_search_fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(
    lower(normalize(coalesce(t, ''), NFC)),
    'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰςÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ',
    'αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσaaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
  )
$$;

-- A phone's digits only, so "24210-10009" finds "+302421010009".
CREATE OR REPLACE FUNCTION oc_search_digits(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g')
$$;

-- The fields are joined by a newline, which a search never contains (the server folds whitespace
-- to one space), so a search cannot match across two fields.
CREATE OR REPLACE FUNCTION delivery_search_fold() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchFold" := oc_search_fold(NEW."orderReference") || E'\n' || oc_search_fold(NEW."dropoffName")
    || E'\n' || oc_search_fold(NEW."pickupBusinessName");
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION courier_search_fold() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchFold" := oc_search_fold(NEW."firstName") || E'\n' || oc_search_fold(NEW."lastName")
    || E'\n' || oc_search_fold(NEW."phoneNumber") || E'\n' || oc_search_digits(NEW."phoneNumber");
  RETURN NEW;
END
$$;

-- Only writes that touch a folded field (or searchFold itself) run the fold, so the status updates
-- that make up most writes skip it; any write to searchFold is overwritten with the real value.
CREATE TRIGGER delivery_search_fold BEFORE INSERT OR UPDATE OF "orderReference", "dropoffName", "pickupBusinessName", "searchFold"
  ON "Delivery" FOR EACH ROW EXECUTE FUNCTION delivery_search_fold();

CREATE TRIGGER courier_search_fold BEFORE INSERT OR UPDATE OF "firstName", "lastName", "phoneNumber", "searchFold"
  ON "Courier" FOR EACH ROW EXECUTE FUNCTION courier_search_fold();

-- Fill every existing row (setting searchFold fires the trigger, which computes it).
UPDATE "Delivery" SET "searchFold" = NULL;
UPDATE "Courier" SET "searchFold" = NULL;
