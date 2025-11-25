-- AlterTable: Add region detection and structured answer fields

-- ChatSession: Add caching fields for region detection
ALTER TABLE "ChatSession"
ADD COLUMN IF NOT EXISTS "cachedRegionData" JSONB,
ADD COLUMN IF NOT EXISTS "skipRegionDetection" BOOLEAN NOT NULL DEFAULT false;

-- Message: Add structured answer fields
ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "questionType" TEXT,
ADD COLUMN IF NOT EXISTS "answerFormat" TEXT,
ADD COLUMN IF NOT EXISTS "structuredAnswer" JSONB,
ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "questionRegions" JSONB,
ADD COLUMN IF NOT EXISTS "selectedRegionId" INTEGER;

-- Attachment: Add platform detection fields
ALTER TABLE "Attachment"
ADD COLUMN IF NOT EXISTS "detectedPlatform" TEXT,
ADD COLUMN IF NOT EXISTS "regionData" JSONB;
