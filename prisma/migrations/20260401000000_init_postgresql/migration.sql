-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "planName" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCache" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductGid" TEXT NOT NULL,
    "sourceMode" TEXT NOT NULL DEFAULT 'APP',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "viewerType" TEXT NOT NULL DEFAULT 'MODEL_3D',
    "modelFileUrl" TEXT,
    "modelFileShopifyGid" TEXT,
    "posterFileUrl" TEXT,
    "posterFileShopifyGid" TEXT,
    "imageSequenceJson" TEXT,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "viewerSettingsJson" TEXT NOT NULL,
    "hotspotsJson360" TEXT,
    "storefrontVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hotspot" (
    "id" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "icon" TEXT,
    "style" TEXT NOT NULL DEFAULT 'card',
    "color" TEXT,
    "positionX" DOUBLE PRECISION NOT NULL,
    "positionY" DOUBLE PRECISION NOT NULL,
    "positionZ" DOUBLE PRECISION NOT NULL,
    "normalX" DOUBLE PRECISION,
    "normalY" DOUBLE PRECISION,
    "normalZ" DOUBLE PRECISION,
    "focusTargetX" DOUBLE PRECISION,
    "focusTargetY" DOUBLE PRECISION,
    "focusTargetZ" DOUBLE PRECISION,
    "focusOrbit" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hotspot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageMode" TEXT NOT NULL DEFAULT 'SHOPIFY_FILE',
    "originalFilename" TEXT NOT NULL,
    "shopifyFileGid" TEXT,
    "url" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "viewerType" TEXT NOT NULL DEFAULT 'MODEL_3D',
    "viewerSettingsJson" TEXT NOT NULL,
    "hotspotsJson" TEXT NOT NULL,
    "hotspotsJson360" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductGid" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "ProductCache_shopId_idx" ON "ProductCache"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCache_shopId_shopifyProductGid_key" ON "ProductCache"("shopId", "shopifyProductGid");

-- CreateIndex
CREATE INDEX "ProductConfig_shopId_idx" ON "ProductConfig"("shopId");

-- CreateIndex
CREATE INDEX "ProductConfig_shopifyProductGid_idx" ON "ProductConfig"("shopifyProductGid");

-- CreateIndex
CREATE UNIQUE INDEX "ProductConfig_shopId_shopifyProductGid_key" ON "ProductConfig"("shopId", "shopifyProductGid");

-- CreateIndex
CREATE INDEX "Hotspot_productConfigId_idx" ON "Hotspot"("productConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "Hotspot_productConfigId_sortOrder_key" ON "Hotspot"("productConfigId", "sortOrder");

-- CreateIndex
CREATE INDEX "Asset_shopId_idx" ON "Asset"("shopId");

-- CreateIndex
CREATE INDEX "Asset_shopifyFileGid_idx" ON "Asset"("shopifyFileGid");

-- CreateIndex
CREATE INDEX "Preset_shopId_idx" ON "Preset"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Preset_shopId_name_key" ON "Preset"("shopId", "name");

-- CreateIndex
CREATE INDEX "SyncRun_shopId_idx" ON "SyncRun"("shopId");

-- CreateIndex
CREATE INDEX "SyncRun_shopifyProductGid_idx" ON "SyncRun"("shopifyProductGid");

-- AddForeignKey
ALTER TABLE "ProductCache" ADD CONSTRAINT "ProductCache_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConfig" ADD CONSTRAINT "ProductConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotspot" ADD CONSTRAINT "Hotspot_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preset" ADD CONSTRAINT "Preset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
