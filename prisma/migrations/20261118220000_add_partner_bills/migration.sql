-- AlterTable
ALTER TABLE "CourierCompensation" ADD COLUMN     "waitMinutes" INTEGER;

-- AlterTable
ALTER TABLE "PartnerCharge" ADD COLUMN     "billId" TEXT,
ADD COLUMN     "waitMinutes" INTEGER;

-- CreateTable
CREATE TABLE "PartnerBill" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "reference" VARCHAR(60),
    "billedByUserId" TEXT,
    "billedByLabel" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneByUserId" TEXT,
    "undoneByLabel" VARCHAR(255),
    "undoReason" VARCHAR(300),

    CONSTRAINT "PartnerBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerBillLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,

    CONSTRAINT "PartnerBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerBill_partnerId_month_idx" ON "PartnerBill"("partnerId", "month");

-- CreateIndex
CREATE INDEX "PartnerBillLine_chargeId_idx" ON "PartnerBillLine"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerBillLine_billId_chargeId_key" ON "PartnerBillLine"("billId", "chargeId");

-- CreateIndex
CREATE INDEX "PartnerCharge_billId_idx" ON "PartnerCharge"("billId");

-- AddForeignKey
ALTER TABLE "PartnerCharge" ADD CONSTRAINT "PartnerCharge_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PartnerBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBill" ADD CONSTRAINT "PartnerBill_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBill" ADD CONSTRAINT "PartnerBill_billedByUserId_fkey" FOREIGN KEY ("billedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBill" ADD CONSTRAINT "PartnerBill_undoneByUserId_fkey" FOREIGN KEY ("undoneByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBillLine" ADD CONSTRAINT "PartnerBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PartnerBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBillLine" ADD CONSTRAINT "PartnerBillLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "PartnerCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill (spec 0036, AC-12): the paid minutes of every existing wait award, read from its message
-- ("Waited N min at C cents a minute"); a null or unreadable message stays null.
UPDATE "CourierCompensation"
SET "waitMinutes" = (substring("message" from 'Waited (\d+) min'))::int
WHERE "reason" = 'WAITING' AND "message" ~ 'Waited \d+ min';

-- Then each wait charge copies its award's minutes, matched by the wait they both belong to.
UPDATE "PartnerCharge" c
SET "waitMinutes" = a."waitMinutes"
FROM "CourierCompensation" a
WHERE c."waitOf" = a."waitOf" AND c."reason" = 'WAITING';
