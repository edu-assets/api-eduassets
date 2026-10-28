ALTER TABLE "Usuario"
  ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Usuario"
  ADD CONSTRAINT "Usuario_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Usuario_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Usuario_createdById_idx" ON "Usuario"("createdById");
CREATE INDEX "Usuario_updatedById_idx" ON "Usuario"("updatedById");
CREATE UNIQUE INDEX "Usuario_login_lower_key" ON "Usuario"(LOWER("login"));

CREATE TABLE "AuditLog" (
  "id" SERIAL NOT NULL,
  "actorId" INTEGER NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "entity" VARCHAR(80) NOT NULL,
  "entityId" VARCHAR(120) NOT NULL,
  "changedFields" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");
