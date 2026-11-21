-- AlterEnum
ALTER TYPE "EnumCourierAccountChangeKind" ADD VALUE 'STATEMENT_DOWNLOADED';

-- CreateTable
CREATE TABLE "StatementDownload" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "format" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatementDownload_courierId_createdAt_idx" ON "StatementDownload"("courierId", "createdAt");

-- AddForeignKey
ALTER TABLE "StatementDownload" ADD CONSTRAINT "StatementDownload_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementDownload" ADD CONSTRAINT "StatementDownload_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

