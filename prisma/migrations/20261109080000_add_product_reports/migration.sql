-- CreateEnum
CREATE TYPE "EnumProductReportKind" AS ENUM ('WRONG_ITEM', 'MISSING_ITEM');

-- CreateEnum
CREATE TYPE "EnumProductReportSource" AS ENUM ('COURIER', 'PARTNER', 'ADMIN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'PRODUCT_REPORTED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'PRODUCT_REPORT_RESOLVED';

-- CreateTable
CREATE TABLE "ProductReport" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "kind" "EnumProductReportKind" NOT NULL,
    "source" "EnumProductReportSource" NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "itemName" VARCHAR(120),
    "note" VARCHAR(500),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolution" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductReport_resolvedAt_createdAt_idx" ON "ProductReport"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReport_deliveryId_createdAt_idx" ON "ProductReport"("deliveryId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

