CREATE TABLE "BusinessSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "name" TEXT NOT NULL,
  "logoUrl" TEXT,
  "gstNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BusinessSettings" ("id", "name", "createdAt", "updatedAt")
VALUES ('default', 'My Business', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
