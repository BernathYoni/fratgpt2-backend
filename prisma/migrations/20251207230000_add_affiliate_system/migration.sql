-- AlterTable
ALTER TABLE "User" ADD COLUMN     "affiliateId" TEXT;

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referralLink" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "payoutRate" DOUBLE PRECISION NOT NULL DEFAULT 5.00,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stripePromoId" TEXT,
    "stripeCouponId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
