-- Spec 0043 (row 9): every delivery carries its box size and the box units it takes.

-- CreateEnum
CREATE TYPE "BoxSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- AlterEnum: three events recorded beside a delivery, never in STATE_MACHINE.
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'BOX_SIZE_ASSUMED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'BOX_SIZE_CHANGED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'BOX_OVER_CAPACITY_CONFIRMED';

-- AlterTable: added nullable first, so the existing rows can be filled in.
ALTER TABLE "Delivery" ADD COLUMN     "boxSize" "BoxSize",
ADD COLUMN     "boxSizeAssumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "boxUnits" INTEGER;

-- Backfill (AC-1, cross check 6): every delivery made before this change counts as Medium, the
-- literal 50 units of the Medium default, and is marked assumed because no restaurant picked it.
UPDATE "Delivery" SET "boxSize" = 'MEDIUM', "boxUnits" = 50, "boxSizeAssumed" = true;

-- Then required, as the schema says.
ALTER TABLE "Delivery" ALTER COLUMN "boxSize" SET NOT NULL,
ALTER COLUMN "boxUnits" SET NOT NULL;
