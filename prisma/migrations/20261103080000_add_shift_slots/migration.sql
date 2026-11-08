-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumShiftSlotChangeAction" AS ENUM ('CREATED', 'UPDATED', 'REMOVED');

-- CreateTable
CREATE TABLE "ShiftSlot" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "riderCap" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSlotChange" (
    "id" TEXT NOT NULL,
    "shiftSlotId" TEXT NOT NULL,
    "action" "EnumShiftSlotChangeAction" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "before" JSON,
    "after" JSON,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftSlotChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftSlot_removedAt_weekday_startMinute_idx" ON "ShiftSlot"("removedAt", "weekday", "startMinute");

-- CreateIndex
CREATE INDEX "ShiftSlotChange_shiftSlotId_createdAt_idx" ON "ShiftSlotChange"("shiftSlotId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShiftSlotChange" ADD CONSTRAINT "ShiftSlotChange_shiftSlotId_fkey" FOREIGN KEY ("shiftSlotId") REFERENCES "ShiftSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

