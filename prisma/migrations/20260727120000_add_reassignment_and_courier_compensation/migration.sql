-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumCourierCompensationReason" AS ENUM ('REASSIGNMENT');

-- AlterEnum
ALTER TYPE "EnumDeliveryEventType" ADD VALUE 'REASSIGNED';

-- CreateTable
CREATE TABLE "CourierCompensation" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" VARCHAR(255) NOT NULL,
    "reason" "EnumCourierCompensationReason" NOT NULL,
    "policy" TEXT NOT NULL,
    "message" TEXT,
    "courierId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierCompensation_courierId_createdAt_idx" ON "CourierCompensation"("courierId", "createdAt");

-- AddForeignKey
ALTER TABLE "CourierCompensation" ADD CONSTRAINT "CourierCompensation_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierCompensation" ADD CONSTRAINT "CourierCompensation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

