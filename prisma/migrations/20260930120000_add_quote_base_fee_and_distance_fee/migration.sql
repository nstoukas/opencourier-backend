-- Spec 0001: every quote stores the two parts the rider is paid.
-- Step 1: add both columns as nullable, so the existing rows are allowed.
ALTER TABLE "DeliveryQuote" ADD COLUMN     "baseFee" INTEGER,
ADD COLUMN     "distanceFee" INTEGER;

-- Step 2: fill the quotes made before this change. They had no base fee, and their whole
-- price was the distance part, so every old delivery is paid by the same rule as a new one.
UPDATE "DeliveryQuote" SET "baseFee" = 0, "distanceFee" = "quoteRangeFrom";

-- Step 3: now that no row is empty, both parts are required.
ALTER TABLE "DeliveryQuote" ALTER COLUMN "baseFee" SET NOT NULL,
ALTER COLUMN "distanceFee" SET NOT NULL;
