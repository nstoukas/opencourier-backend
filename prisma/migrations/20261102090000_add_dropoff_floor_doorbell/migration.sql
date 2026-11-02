-- AlterEnum
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'DROPOFF_POINT_CORRECTED';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "dropoffDoorbell" VARCHAR(60),
ADD COLUMN     "dropoffFloor" VARCHAR(20),
ADD COLUMN     "dropoffPointCorrectedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "SavedCustomer" ADD COLUMN     "doorbell" VARCHAR(60),
ADD COLUMN     "floor" VARCHAR(20);


-- Spec 0016 (decision 31.4): spec 0006 kept "Floor and doorbell" in addressLine2. Move it into
-- doorbell (cut to the new column's 60 characters) and empty addressLine2, which request-web no
-- longer writes. The restaurant can split it into floor and doorbell on its next edit.
UPDATE "SavedCustomer"
SET "doorbell" = NULLIF(LEFT(BTRIM("addressLine2"), 60), ''), "addressLine2" = NULL
WHERE "addressLine2" IS NOT NULL;
