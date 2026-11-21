-- Spec 0044 (rows 12 and 13): why each offer went to its rider, one row per OFFERED event.

-- CreateTable
CREATE TABLE "OfferReason" (
    "id" TEXT NOT NULL,
    "deliveryEventId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "weights" JSONB,
    "values" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "ridersInRange" INTEGER NOT NULL DEFAULT 0,
    "candidates" JSONB,
    "kind" TEXT NOT NULL DEFAULT 'SINGLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferReason_deliveryEventId_key" ON "OfferReason"("deliveryEventId");

-- CreateIndex
CREATE INDEX "OfferReason_courierId_createdAt_idx" ON "OfferReason"("courierId", "createdAt");

-- CreateIndex
CREATE INDEX "OfferReason_deliveryId_idx" ON "OfferReason"("deliveryId");

-- AddForeignKey
ALTER TABLE "OfferReason" ADD CONSTRAINT "OfferReason_deliveryEventId_fkey" FOREIGN KEY ("deliveryEventId") REFERENCES "DeliveryEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

