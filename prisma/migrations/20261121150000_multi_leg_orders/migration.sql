-- Spec 0046 (row 10): multi leg orders. Two labels on a delivery, "leg 1 of 2".

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "legCount" INTEGER,
ADD COLUMN     "legNumber" INTEGER;

-- Both null (a single delivery), or both set with 1 <= legNumber <= legCount and 2 <= legCount <= 4.
-- The API answers 400 first; this keeps any other writer honest too.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_leg_labels_consistent" CHECK (
  ("legNumber" IS NULL AND "legCount" IS NULL)
  OR ("legCount" BETWEEN 2 AND 4 AND "legNumber" BETWEEN 1 AND "legCount")
);

-- CreateIndex
-- One leg number per order (cross check 1). NULLs are distinct, so single deliveries never collide.
CREATE UNIQUE INDEX "Delivery_partnerId_orderReference_legNumber_key" ON "Delivery"("partnerId", "orderReference", "legNumber");
