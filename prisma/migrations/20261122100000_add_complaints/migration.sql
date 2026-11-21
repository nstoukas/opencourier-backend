-- CreateEnum
CREATE TYPE "EnumComplaintFiledBy" AS ENUM ('RIDER', 'RESTAURANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "EnumComplaintAbout" AS ENUM ('RESTAURANT', 'CUSTOMER', 'RIDER');

-- CreateEnum
CREATE TYPE "EnumComplaintStatus" AS ENUM ('OPEN', 'AWAITING_REPLY', 'DECIDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EnumComplaintCategory" AS ENUM ('LONG_WAIT', 'FOOD_NOT_READY', 'UNSAFE_PACKAGING', 'RUDE_STAFF', 'ABUSE_OR_THREAT', 'UNSAFE_ADDRESS', 'NOT_ANSWERING', 'LATE', 'RUDE', 'FOOD_DAMAGED', 'OTHER');

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "filedBy" "EnumComplaintFiledBy" NOT NULL,
    "about" "EnumComplaintAbout" NOT NULL,
    "category" "EnumComplaintCategory" NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "status" "EnumComplaintStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openFor" TEXT,
    "deliveryId" TEXT NOT NULL,
    "filerCourierId" TEXT,
    "filerPartnerId" TEXT,
    "filerAdminId" TEXT,
    "aboutCourierId" TEXT,
    "riderReply" VARCHAR(1000),
    "repliedAt" TIMESTAMP(3),
    "replyEnteredByUserId" TEXT,
    "outcome" VARCHAR(1000),
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "withdrawnReason" VARCHAR(1000),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnByUserId" TEXT,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_openFor_key" ON "Complaint"("openFor");

-- CreateIndex
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_about_createdAt_idx" ON "Complaint"("about", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_deliveryId_idx" ON "Complaint"("deliveryId");

-- CreateIndex
CREATE INDEX "Complaint_filerCourierId_createdAt_idx" ON "Complaint"("filerCourierId", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_filerPartnerId_createdAt_idx" ON "Complaint"("filerPartnerId", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_aboutCourierId_createdAt_idx" ON "Complaint"("aboutCourierId", "createdAt");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_filerCourierId_fkey" FOREIGN KEY ("filerCourierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_filerPartnerId_fkey" FOREIGN KEY ("filerPartnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_filerAdminId_fkey" FOREIGN KEY ("filerAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_aboutCourierId_fkey" FOREIGN KEY ("aboutCourierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_replyEnteredByUserId_fkey" FOREIGN KEY ("replyEnteredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_withdrawnByUserId_fkey" FOREIGN KEY ("withdrawnByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand written (spec 0052, AC-1): the filer id matches filedBy, and only a complaint about a rider
-- names a rider. An admin filer's id may become null if that admin user is deleted (SET NULL).
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_filer_matches_filedBy" CHECK (
  ("filedBy" = 'RIDER' AND "filerCourierId" IS NOT NULL AND "filerPartnerId" IS NULL AND "filerAdminId" IS NULL)
  OR ("filedBy" = 'RESTAURANT' AND "filerPartnerId" IS NOT NULL AND "filerCourierId" IS NULL AND "filerAdminId" IS NULL)
  OR ("filedBy" = 'ADMIN' AND "filerCourierId" IS NULL AND "filerPartnerId" IS NULL)
);
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_about_rider_names_rider" CHECK (
  ("about" = 'RIDER') = ("aboutCourierId" IS NOT NULL)
);
