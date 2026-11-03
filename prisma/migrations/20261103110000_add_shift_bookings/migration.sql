-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumShiftBookingStatus" AS ENUM ('BOOKED', 'DROPPED', 'SWAPPED_AWAY');

-- CreateEnum
CREATE TYPE "EnumShiftBookingEventType" AS ENUM ('BOOKED', 'DROPPED', 'SWAP_OFFERED', 'SWAP_WITHDRAWN', 'SWAP_TAKEN');

-- CreateTable
CREATE TABLE "ShiftBooking" (
    "id" TEXT NOT NULL,
    "shiftSlotId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capAtBooking" INTEGER NOT NULL,
    "status" "EnumShiftBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "swapOfferedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftBookingEvent" (
    "id" TEXT NOT NULL,
    "shiftBookingId" TEXT NOT NULL,
    "type" "EnumShiftBookingEventType" NOT NULL,
    "courierId" TEXT NOT NULL,
    "otherCourierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftBookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftBooking_shiftSlotId_date_status_idx" ON "ShiftBooking"("shiftSlotId", "date", "status");

-- CreateIndex
CREATE INDEX "ShiftBooking_courierId_status_startsAt_idx" ON "ShiftBooking"("courierId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftBookingEvent_shiftBookingId_createdAt_idx" ON "ShiftBookingEvent"("shiftBookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShiftBooking" ADD CONSTRAINT "ShiftBooking_shiftSlotId_fkey" FOREIGN KEY ("shiftSlotId") REFERENCES "ShiftSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftBooking" ADD CONSTRAINT "ShiftBooking_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftBookingEvent" ADD CONSTRAINT "ShiftBookingEvent_shiftBookingId_fkey" FOREIGN KEY ("shiftBookingId") REFERENCES "ShiftBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

