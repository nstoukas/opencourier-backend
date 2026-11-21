-- Spec 0047 (row 11): split at pickup. A rider's split request, its events, the restaurant's charges and
-- the split wait's once only keys, and the quote source for a new leg's copied quote.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumSplitRequestStatus" AS ENUM ('OPEN', 'CONFIRMED', 'REFUSED', 'LEFT', 'VOID');

-- CreateEnum
CREATE TYPE "EnumQuoteSource" AS ENUM ('PARTNER', 'SPLIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'SPLIT_REQUESTED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'SPLIT_CONFIRMED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'SPLIT_REFUSED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'SPLIT_CLOSED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'PARTNER_CHARGED_FOR_SPLIT';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'PARTNER_SPLIT_CHARGE_VOIDED';

-- AlterEnum
ALTER TYPE "EnumPartnerChargeReason" ADD VALUE 'SPLIT_LEG';

-- AlterTable
ALTER TABLE "CourierCompensation" ADD COLUMN     "splitWaitOf" TEXT;

-- AlterTable
ALTER TABLE "DeliveryQuote" ADD COLUMN     "source" "EnumQuoteSource" NOT NULL DEFAULT 'PARTNER';

-- AlterTable
ALTER TABLE "PartnerCharge" ADD COLUMN     "splitLegOf" TEXT,
ADD COLUMN     "splitWaitOf" TEXT;

-- CreateTable
CREATE TABLE "SplitRequest" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "proposedLegs" JSONB NOT NULL,
    "finalLegs" JSONB,
    "status" "EnumSplitRequestStatus" NOT NULL DEFAULT 'OPEN',
    "openFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "answeredByUserId" TEXT,
    "adminNote" VARCHAR(300),

    CONSTRAINT "SplitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SplitRequest_openFor_key" ON "SplitRequest"("openFor");

-- CreateIndex
CREATE INDEX "SplitRequest_status_createdAt_idx" ON "SplitRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SplitRequest_deliveryId_createdAt_idx" ON "SplitRequest"("deliveryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCompensation_splitWaitOf_key" ON "CourierCompensation"("splitWaitOf");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCharge_splitLegOf_key" ON "PartnerCharge"("splitLegOf");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCharge_splitWaitOf_key" ON "PartnerCharge"("splitWaitOf");

-- AddForeignKey
ALTER TABLE "SplitRequest" ADD CONSTRAINT "SplitRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitRequest" ADD CONSTRAINT "SplitRequest_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitRequest" ADD CONSTRAINT "SplitRequest_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
