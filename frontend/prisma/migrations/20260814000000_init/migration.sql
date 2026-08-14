-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MapProvider" AS ENUM ('NAVER', 'KAKAO', 'GOOGLE');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'YOUTUBE', 'OTHER');

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "mapProvider" "MapProvider" NOT NULL DEFAULT 'NAVER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedPost" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "thumbnail" TEXT,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "category" TEXT,
    "naverLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedPostPlace" (
    "postId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "memo" TEXT,

    CONSTRAINT "SavedPostPlace_pkey" PRIMARY KEY ("postId","placeId")
);

-- CreateIndex
CREATE INDEX "SavedPost_userId_createdAt_idx" ON "SavedPost"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedPost_userId_sourceUrl_key" ON "SavedPost"("userId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Place_name_address_key" ON "Place"("name", "address");

-- CreateIndex
CREATE INDEX "SavedPostPlace_placeId_idx" ON "SavedPostPlace"("placeId");

-- AddForeignKey
ALTER TABLE "SavedPost" ADD CONSTRAINT "SavedPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedPostPlace" ADD CONSTRAINT "SavedPostPlace_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SavedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedPostPlace" ADD CONSTRAINT "SavedPostPlace_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

