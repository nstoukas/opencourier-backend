-- CreateEnum
CREATE TYPE "EnumCourierAccountChangeKind" AS ENUM ('DEACTIVATED', 'REACTIVATED', 'FIELD_EDITED', 'PASSWORD_CHANGED');

-- AlterEnum
ALTER TYPE "EnumCourierStatusChangeCause" ADD VALUE 'DEACTIVATED';

-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedByUserId" TEXT,
ADD COLUMN     "emergencyContactName" VARCHAR(120),
ADD COLUMN     "emergencyContactPhone" VARCHAR(32);

-- AlterTable
ALTER TABLE "ShiftBookingEvent" ADD COLUMN     "adminUserId" TEXT;

-- CreateTable
CREATE TABLE "CourierAccountChange" (
    "id" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorIsRider" BOOLEAN NOT NULL DEFAULT false,
    "kind" "EnumCourierAccountChangeKind" NOT NULL,
    "field" VARCHAR(60),
    "oldValue" VARCHAR(300),
    "newValue" VARCHAR(300),
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierAccountChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierAccountChange_courierId_createdAt_idx" ON "CourierAccountChange"("courierId", "createdAt");

-- AddForeignKey
ALTER TABLE "CourierAccountChange" ADD CONSTRAINT "CourierAccountChange_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

