-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumReviewTopic" AS ENUM ('OFFER', 'PAY', 'OTHER');

-- CreateEnum
CREATE TYPE "EnumReviewRequestStatus" AS ENUM ('OPEN', 'ANSWERED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EnumReviewOutcome" AS ENUM ('STANDS', 'CHANGED');

-- AlterEnum
ALTER TYPE "EnumCourierCompensationReason" ADD VALUE 'REVIEW';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REVIEW_REQUESTED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REVIEW_ANSWERED';
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'COURIER_PAID_FOR_REVIEW';

-- AlterTable
ALTER TABLE "CourierCompensation" ADD COLUMN     "reviewOf" TEXT;

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "topic" "EnumReviewTopic" NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "status" "EnumReviewRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "openFor" TEXT,
    "answeredAt" TIMESTAMP(3),
    "outcome" "EnumReviewOutcome",
    "answer" VARCHAR(2000),
    "withdrawnAt" TIMESTAMP(3),
    "courierId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "answeredByUserId" TEXT,

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettingChange" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(100),
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT,

    CONSTRAINT "SettingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_openFor_key" ON "ReviewRequest"("openFor");

-- CreateIndex
CREATE INDEX "ReviewRequest_status_dueAt_idx" ON "ReviewRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_courierId_createdAt_idx" ON "ReviewRequest"("courierId", "createdAt");

-- CreateIndex
CREATE INDEX "SettingChange_createdAt_idx" ON "SettingChange"("createdAt");

-- CreateIndex
CREATE INDEX "SettingChange_key_createdAt_idx" ON "SettingChange"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCompensation_reviewOf_key" ON "CourierCompensation"("reviewOf");

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingChange" ADD CONSTRAINT "SettingChange_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

