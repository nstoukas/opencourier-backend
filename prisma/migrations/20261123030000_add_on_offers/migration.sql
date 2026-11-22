-- Spec 0048 (row 81, AC-6): what an add on offer adds to the rider's current job, in road metres and seconds.
-- Generated with `prisma migrate diff`. Nullable and additive: every existing delivery is no add on (null).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "addOnExtraMetres" INTEGER,
ADD COLUMN     "addOnExtraSeconds" INTEGER;

