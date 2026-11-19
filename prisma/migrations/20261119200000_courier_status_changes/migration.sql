-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumCourierStatusChangeCause" AS ENUM ('RIDER', 'ADMIN', 'CUT_OFF', 'LAST_CALL_ACCEPTED', 'SYSTEM_START');

-- CreateTable
CREATE TABLE "CourierStatusChange" (
    "id" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "fromStatus" "EnumCourierStatus" NOT NULL,
    "toStatus" "EnumCourierStatus" NOT NULL,
    "cause" "EnumCourierStatusChangeCause" NOT NULL,
    "adminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierStatusChange_courierId_createdAt_idx" ON "CourierStatusChange"("courierId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierStatusChange_createdAt_idx" ON "CourierStatusChange"("createdAt");

-- AddForeignKey
ALTER TABLE "CourierStatusChange" ADD CONSTRAINT "CourierStatusChange_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierStatusChange" ADD CONSTRAINT "CourierStatusChange_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A row never records a change to the same status (spec 0040, AC-1).
ALTER TABLE "CourierStatusChange" ADD CONSTRAINT "CourierStatusChange_status_differs" CHECK ("fromStatus" <> "toStatus");

-- Spec 0040, AC-3: open the shifts already running. Every rider who is not Offline now gets one
-- SYSTEM_START row, from OFFLINE to their current status, at migration time.
INSERT INTO "CourierStatusChange" ("id", "courierId", "fromStatus", "toStatus", "cause", "createdAt")
SELECT 'csc_start_' || c."id", c."id", 'OFFLINE', c."status", 'SYSTEM_START', clock_timestamp()
FROM "Courier" c
WHERE c."status" <> 'OFFLINE';

-- Spec 0040, AC-3: name the rider on the latest successful ACCEPTED of every delivery still in
-- progress (the DELIVERY_ONGOING_STATUSES list), so a job in progress shows from deploy.
UPDATE "DeliveryEvent" e
SET "courierId" = d."courierId"
FROM "Delivery" d
WHERE e."id" = (
    SELECT e2."id" FROM "DeliveryEvent" e2
    WHERE e2."deliveryId" = d."id" AND e2."type" = 'ACCEPTED' AND e2."transitionSuccessful" = true
    ORDER BY e2."createdAt" DESC, e2."id" DESC
    LIMIT 1
  )
  AND d."courierId" IS NOT NULL
  AND d."status" IN ('ACCEPTED', 'DISPATCHED', 'COURIER_ARRIVED_AT_PICKUP_LOCATION', 'PICKED_UP', 'ON_THE_WAY', 'COURIER_ARRIVED_AT_DROPOFF_LOCATION');
