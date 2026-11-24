-- AlterEnum
-- Row 160: a restaurant's edit that changes the tip is recorded as a DeliveryEvent.
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'TIP_CHANGED';
