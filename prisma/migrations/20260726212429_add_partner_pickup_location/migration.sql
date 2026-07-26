-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "pickupLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

