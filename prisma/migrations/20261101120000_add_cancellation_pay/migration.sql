-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumCancelledBy" AS ENUM ('RESTAURANT', 'CUSTOMER', 'COOP');

-- CreateEnum
CREATE TYPE "EnumFoodOutcome" AS ENUM ('RETURNED', 'NOT_RETURNED');

-- CreateEnum
CREATE TYPE "EnumPartnerChargeReason" AS ENUM ('CANCELLATION');

-- AlterEnum
ALTER TYPE "EnumCourierCompensationReason" ADD VALUE 'CANCELLATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'COURIER_PAID_FOR_CANCELLATION';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'FOOD_RETURNED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'FOOD_NOT_RETURNED';

-- AlterTable
ALTER TABLE "CourierCompensation" ADD COLUMN     "cancellationOf" TEXT;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" "EnumCancelledBy",
ADD COLUMN     "cancelledFromStatus" "EnumDeliveryStatus",
ADD COLUMN     "foodOutcome" "EnumFoodOutcome",
ADD COLUMN     "foodOutcomeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PartnerCharge" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" VARCHAR(255) NOT NULL,
    "reason" "EnumPartnerChargeReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoicedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCharge_deliveryId_key" ON "PartnerCharge"("deliveryId");

-- CreateIndex
CREATE INDEX "PartnerCharge_partnerId_createdAt_idx" ON "PartnerCharge"("partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCompensation_cancellationOf_key" ON "CourierCompensation"("cancellationOf");

-- CreateIndex
CREATE INDEX "Delivery_courierId_cancelledAt_idx" ON "Delivery"("courierId", "cancelledAt");

-- AddForeignKey
ALTER TABLE "PartnerCharge" ADD CONSTRAINT "PartnerCharge_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCharge" ADD CONSTRAINT "PartnerCharge_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

