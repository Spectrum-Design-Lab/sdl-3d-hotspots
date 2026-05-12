-- CreateTable
CREATE TABLE "ShopStorage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "accessKeyEncrypted" BYTEA NOT NULL,
    "secretKeyEncrypted" BYTEA NOT NULL,
    "publicBaseUrl" TEXT,
    "testedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopStorage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopStorage_shopId_key" ON "ShopStorage"("shopId");

-- AddForeignKey
ALTER TABLE "ShopStorage" ADD CONSTRAINT "ShopStorage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
