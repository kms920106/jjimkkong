-- CreateTable
CREATE TABLE "PlaceBlog" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bloggername" TEXT NOT NULL,
    "postdate" TEXT NOT NULL,

    CONSTRAINT "PlaceBlog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaceBlog_placeId_position_idx" ON "PlaceBlog"("placeId", "position");

-- AddForeignKey
ALTER TABLE "PlaceBlog" ADD CONSTRAINT "PlaceBlog_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
