-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rawKey" TEXT NOT NULL,
    "rawSizeBytes" INTEGER,
    "frameCountTarget" INTEGER NOT NULL DEFAULT 72,
    "frameCountActual" INTEGER,
    "processedManifestKey" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Capture_productConfigId_idx" ON "Capture"("productConfigId");

-- CreateIndex
CREATE INDEX "Capture_status_idx" ON "Capture"("status");

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
