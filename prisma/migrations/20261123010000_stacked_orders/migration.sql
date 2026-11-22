-- Spec 0048 (row 80): the two deliveries of a stacked offer share offerGroupId. Generated with
-- `prisma migrate diff`. Nullable and additive: every existing delivery is a single offer (null).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "offerGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Delivery_offerGroupId_idx" ON "Delivery"("offerGroupId");

