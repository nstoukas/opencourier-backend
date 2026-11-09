-- CreateEnum
CREATE TYPE "EnumRemovalRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumCourierCompensationReason" ADD VALUE 'REMOVAL';
ALTER TYPE "EnumCourierCompensationReason" ADD VALUE 'RETURN_TRIP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REMOVAL_REQUESTED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REMOVAL_WITHDRAWN';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REMOVAL_DECLINED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REMOVAL_APPROVED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'COURIER_PAID_FOR_REMOVAL';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'PARTNER_CHARGED_FOR_REMOVAL';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'COURIER_PAID_FOR_RETURN_TRIP';

-- AlterEnum
ALTER TYPE "EnumPartnerChargeReason" ADD VALUE 'REMOVAL';

-- AlterTable
ALTER TABLE "CourierCompensation" ADD COLUMN     "removalOf" TEXT,
ADD COLUMN     "returnOf" TEXT;

-- AlterTable
ALTER TABLE "PartnerCharge" ADD COLUMN     "removalOf" TEXT;

-- CreateTable
CREATE TABLE "RemovalReason" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "paidToRider" BOOLEAN NOT NULL DEFAULT true,
    "chargedToRestaurant" BOOLEAN NOT NULL DEFAULT false,
    "needsNote" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemovalReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRemovalRequest" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "paidToRider" BOOLEAN NOT NULL,
    "chargedToRestaurant" BOOLEAN NOT NULL,
    "note" VARCHAR(500),
    "status" "EnumRemovalRequestStatus" NOT NULL DEFAULT 'OPEN',
    "openFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" VARCHAR(500),
    "payAmount" INTEGER,
    "payPolicy" TEXT,
    "afterPickup" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryRemovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRemovalRequest_openFor_key" ON "DeliveryRemovalRequest"("openFor");

-- CreateIndex
CREATE INDEX "DeliveryRemovalRequest_status_createdAt_idx" ON "DeliveryRemovalRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryRemovalRequest_deliveryId_createdAt_idx" ON "DeliveryRemovalRequest"("deliveryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCompensation_removalOf_key" ON "CourierCompensation"("removalOf");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCompensation_returnOf_key" ON "CourierCompensation"("returnOf");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCharge_removalOf_key" ON "PartnerCharge"("removalOf");

-- AddForeignKey
ALTER TABLE "DeliveryRemovalRequest" ADD CONSTRAINT "DeliveryRemovalRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRemovalRequest" ADD CONSTRAINT "DeliveryRemovalRequest_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRemovalRequest" ADD CONSTRAINT "DeliveryRemovalRequest_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "RemovalReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRemovalRequest" ADD CONSTRAINT "DeliveryRemovalRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the starting reasons (spec 0035, AC-1). Fixed ids, so the row is the same on every instance.
INSERT INTO "RemovalReason" ("id", "label", "paidToRider", "chargedToRestaurant", "needsNote", "position", "updatedAt") VALUES
  ('removal_reason_moped_breakdown', 'Moped breakdown or accident', true, false, false, 1, CURRENT_TIMESTAMP),
  ('removal_reason_restaurant_closed', 'Restaurant closed', true, false, false, 2, CURRENT_TIMESTAMP),
  ('removal_reason_food_not_ready', 'Food not ready', true, false, false, 3, CURRENT_TIMESTAMP),
  ('removal_reason_unsafe_drop_off', 'Unsafe drop off', true, false, false, 4, CURRENT_TIMESTAMP),
  ('removal_reason_customer_unreachable', 'Customer unreachable', true, false, false, 5, CURRENT_TIMESTAMP),
  ('removal_reason_personal_emergency', 'Personal emergency', true, false, false, 6, CURRENT_TIMESTAMP),
  ('removal_reason_other', 'Other', true, false, true, 7, CURRENT_TIMESTAMP);
