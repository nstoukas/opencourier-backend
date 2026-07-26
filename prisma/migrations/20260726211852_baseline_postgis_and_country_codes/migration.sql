-- Baseline migration: brings the migration history in line with a database that
-- was already changed directly. Both statements below were applied to the dev DB
-- long before this file existed, so this migration is marked as already-applied
-- via 'prisma migrate resolve --applied' and is NEVER executed against that DB.
-- It exists so a FRESH database can be built from migrations alone.
--
-- The enum expansion is deviation b7d84e9 in ../memory.md: EnumCountryCode was
-- US-only and every Greek address 500'd.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnumCountryCode" ADD VALUE 'GR';
ALTER TYPE "EnumCountryCode" ADD VALUE 'CA';
ALTER TYPE "EnumCountryCode" ADD VALUE 'GB';
ALTER TYPE "EnumCountryCode" ADD VALUE 'AU';
ALTER TYPE "EnumCountryCode" ADD VALUE 'MX';

