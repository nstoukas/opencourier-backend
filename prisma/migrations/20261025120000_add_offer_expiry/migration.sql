-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'OFFERED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'OFFER_EXPIRED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'NO_COURIER_AVAILABLE';

-- AlterEnum
ALTER TYPE "EnumEventActor" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "offerExpiresAt" TIMESTAMP(3),
ADD COLUMN     "offeredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DeliveryEvent" ADD COLUMN     "courierId" TEXT;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

