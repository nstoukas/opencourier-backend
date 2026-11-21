-- AlterEnum
ALTER TYPE "EnumShiftBookingEventType" ADD VALUE 'WENT_OFFLINE_MID_SHIFT';

-- AlterTable
ALTER TABLE "ShiftBookingEvent" ADD COLUMN     "cause" "EnumCourierStatusChangeCause",
ADD COLUMN     "courierStatusChangeId" TEXT,
ADD COLUMN     "followedUpAt" TIMESTAMP(3),
ADD COLUMN     "followedUpByUserId" TEXT,
ADD COLUMN     "offlineAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftBookingEvent_courierStatusChangeId_key" ON "ShiftBookingEvent"("courierStatusChangeId");

-- CreateIndex
CREATE INDEX "ShiftBookingEvent_type_followedUpAt_idx" ON "ShiftBookingEvent"("type", "followedUpAt");

-- AddForeignKey
ALTER TABLE "ShiftBookingEvent" ADD CONSTRAINT "ShiftBookingEvent_followedUpByUserId_fkey" FOREIGN KEY ("followedUpByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

