-- AlterEnum
ALTER TYPE "EnumCourierCompensationReason" ADD VALUE 'WAITING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'WAIT_UNDISPATCHED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'COURIER_PAID_FOR_WAIT';

-- AlterEnum
ALTER TYPE "EnumPartnerChargeReason" ADD VALUE 'WAITING';

-- DropIndex
DROP INDEX "PartnerCharge_deliveryId_key";

-- AlterTable
ALTER TABLE "CourierCompensation" ADD COLUMN     "waitOf" TEXT;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "arrivedAtPickupAt" TIMESTAMP(3),
ADD COLUMN     "promisedReadyAt" TIMESTAMP(3),
ADD COLUMN     "undispatchedAt" TIMESTAMP(3),
ADD COLUMN     "waitPayOwedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerCharge" ADD COLUMN     "cancellationOf" TEXT,
ADD COLUMN     "waitOf" TEXT;

-- Every charge so far is a cancellation: it keeps its once only key under the new column.
UPDATE "PartnerCharge" SET "cancellationOf" = "deliveryId";

-- A delivery already placed keeps the time it promised.
UPDATE "Delivery" SET "promisedReadyAt" = "readyAt" WHERE "readyAt" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CourierCompensation_waitOf_key" ON "CourierCompensation"("waitOf");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCharge_cancellationOf_key" ON "PartnerCharge"("cancellationOf");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCharge_waitOf_key" ON "PartnerCharge"("waitOf");

