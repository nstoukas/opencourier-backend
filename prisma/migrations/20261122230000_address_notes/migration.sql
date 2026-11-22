-- Spec 0053 (row 82): courier notes sit on a point and expire unless riders confirm them.
-- Generated with `prisma migrate diff`, then the LocationNote columns were split into add, backfill,
-- delete and NOT NULL steps by hand, because existing notes have no point yet (AC-1).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable: the rider's moved pin, written with DROPOFF_POINT_CORRECTED from now on (cross check 1).
-- Older moves are filled in by scripts/backfillDropoffCorrectedPoint.ts from their event messages.
ALTER TABLE "Delivery" ADD COLUMN     "dropoffCorrectedLatitude" DOUBLE PRECISION,
ADD COLUMN     "dropoffCorrectedLongitude" DOUBLE PRECISION;

-- AlterTable: added nullable first, so the backfill below can fill them.
ALTER TABLE "LocationNote" ADD COLUMN     "lastConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- Backfill (AC-1): the note's own Location's point, else its delivery's drop off Location.
UPDATE "LocationNote" n
SET "latitude" = l."latitude", "longitude" = l."longitude"
FROM "Location" l
WHERE l."id" = n."locationId";

UPDATE "LocationNote" n
SET "latitude" = dl."latitude", "longitude" = dl."longitude"
FROM "Delivery" d
JOIN "Location" dl ON dl."id" = d."dropoffLocationId"
WHERE n."latitude" IS NULL AND d."id" = n."deliveryId";

-- A note with no place (only a rider) cannot be shown anywhere: deleted (AC-1, cross check 4).
-- The dry run on the dev database on 2026-11-22 counted 0 such notes out of 5.
DELETE FROM "LocationNote" WHERE "latitude" IS NULL OR "longitude" IS NULL;

-- The clock starts at the note's creation.
UPDATE "LocationNote" SET "lastConfirmedAt" = "createdAt";

ALTER TABLE "LocationNote" ALTER COLUMN "latitude" SET NOT NULL,
ALTER COLUMN "longitude" SET NOT NULL,
ALTER COLUMN "lastConfirmedAt" SET NOT NULL,
ALTER COLUMN "lastConfirmedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "LocationNoteFlag" (
    "id" TEXT NOT NULL,
    "locationNoteId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "reason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationNoteFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressNoteDeletion" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "locationNoteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressNoteDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationNoteFlag_locationNoteId_courierId_key" ON "LocationNoteFlag"("locationNoteId", "courierId");

-- CreateIndex
CREATE INDEX "LocationNote_lastConfirmedAt_idx" ON "LocationNote"("lastConfirmedAt");

-- CreateIndex
CREATE INDEX "LocationNote_latitude_longitude_idx" ON "LocationNote"("latitude", "longitude");

-- AddForeignKey
ALTER TABLE "LocationNoteFlag" ADD CONSTRAINT "LocationNoteFlag_locationNoteId_fkey" FOREIGN KEY ("locationNoteId") REFERENCES "LocationNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationNoteFlag" ADD CONSTRAINT "LocationNoteFlag_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
