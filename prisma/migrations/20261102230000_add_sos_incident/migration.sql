-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumSosOutcome" AS ENUM ('RIDER_SAFE', 'HELP_ARRIVED', 'FALSE_ALARM', 'OTHER');

-- CreateTable
CREATE TABLE "SosIncident" (
    "id" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "clientId" VARCHAR(64) NOT NULL,
    "deliveryId" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "safeAt" TIMESTAMPTZ(6),
    "falseAlarmAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "closedByUserId" TEXT,
    "outcome" "EnumSosOutcome",
    "note" VARCHAR(500),
    "pointsDeletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SosIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosLocationPoint" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMetres" DOUBLE PRECISION,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosLocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SosIncident_courierId_closedAt_idx" ON "SosIncident"("courierId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SosIncident_courierId_clientId_key" ON "SosIncident"("courierId", "clientId");

-- CreateIndex
CREATE INDEX "SosLocationPoint_incidentId_recordedAt_idx" ON "SosLocationPoint"("incidentId", "recordedAt");

-- AddForeignKey
ALTER TABLE "SosIncident" ADD CONSTRAINT "SosIncident_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosIncident" ADD CONSTRAINT "SosIncident_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosIncident" ADD CONSTRAINT "SosIncident_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosLocationPoint" ADD CONSTRAINT "SosLocationPoint_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SosIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

