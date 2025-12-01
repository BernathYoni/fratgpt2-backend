-- AlterTable: Add detailed token tracking fields to Usage table
ALTER TABLE "Usage" ADD COLUMN     "geminiFlashInputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "geminiFlashOutputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "geminiFlashCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "geminiProInputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "geminiProOutputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "geminiProCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "openaiInputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openaiOutputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openaiCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "claudeInputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claudeOutputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claudeThinkingTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claudeCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalMonthlyCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable: AdminStats for site-wide analytics
CREATE TABLE "AdminStats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "geminiFlashInputTokens" BIGINT NOT NULL DEFAULT 0,
    "geminiFlashOutputTokens" BIGINT NOT NULL DEFAULT 0,
    "geminiFlashCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geminiProInputTokens" BIGINT NOT NULL DEFAULT 0,
    "geminiProOutputTokens" BIGINT NOT NULL DEFAULT 0,
    "geminiProCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openaiInputTokens" BIGINT NOT NULL DEFAULT 0,
    "openaiOutputTokens" BIGINT NOT NULL DEFAULT 0,
    "openaiCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "claudeInputTokens" BIGINT NOT NULL DEFAULT 0,
    "claudeOutputTokens" BIGINT NOT NULL DEFAULT 0,
    "claudeThinkingTokens" BIGINT NOT NULL DEFAULT 0,
    "claudeCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMonthlyCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminStats_date_key" ON "AdminStats"("date");

-- CreateIndex
CREATE INDEX "AdminStats_date_idx" ON "AdminStats"("date");
