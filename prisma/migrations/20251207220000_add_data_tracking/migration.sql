-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Interaction_chatSessionId_idx" ON "Interaction"("chatSessionId");

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
