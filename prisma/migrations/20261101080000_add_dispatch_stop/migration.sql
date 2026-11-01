-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumDispatchStopReason" AS ENUM ('HEAT', 'STORM', 'OTHER');

-- AlterEnum
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'RETURNED_TO_WAITING';

-- CreateTable
CREATE TABLE "DispatchStop" (
    "id" TEXT NOT NULL,
    "reason" "EnumDispatchStopReason" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "endWorkDoneAt" TIMESTAMP(3),

    CONSTRAINT "DispatchStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchStop_startsAt_idx" ON "DispatchStop"("startsAt");

