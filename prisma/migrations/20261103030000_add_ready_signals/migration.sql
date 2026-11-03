-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'READY_DELAYED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'FOOD_READY';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "foodReadyAt" TIMESTAMPTZ(6),
ADD COLUMN     "readyAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "usualPrepMinutes" INTEGER NOT NULL DEFAULT 15;

