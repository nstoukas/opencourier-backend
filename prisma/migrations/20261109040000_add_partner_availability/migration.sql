-- CreateEnum
CREATE TYPE "EnumPartnerAvailabilityAction" AS ENUM ('BUSY_ON', 'BUSY_OFF', 'PAUSED', 'RESUMED', 'DISABLED', 'ENABLED');

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "busyExtraMinutes" INTEGER,
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" VARCHAR(200),
ADD COLUMN     "pausedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PartnerAvailabilityChange" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "action" "EnumPartnerAvailabilityAction" NOT NULL,
    "actorRole" "EnumUserRole" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "extraMinutes" INTEGER,
    "pausedUntil" TIMESTAMP(3),
    "reason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerAvailabilityChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerAvailabilityChange_partnerId_createdAt_idx" ON "PartnerAvailabilityChange"("partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "PartnerAvailabilityChange" ADD CONSTRAINT "PartnerAvailabilityChange_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

