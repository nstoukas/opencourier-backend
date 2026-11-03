-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "SavedCustomer" ADD COLUMN     "pinMovedByRiderAt" TIMESTAMPTZ(6);

