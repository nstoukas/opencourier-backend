-- AlterEnum
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'HANDED_BACK';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "acceptedAt" TIMESTAMPTZ(6),
ADD COLUMN     "handBackUntil" TIMESTAMPTZ(6);

