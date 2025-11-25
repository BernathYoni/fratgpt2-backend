-- AlterTable: Remove detectedPlatform column from Attachment table
ALTER TABLE "Attachment" DROP COLUMN IF EXISTS "detectedPlatform";
