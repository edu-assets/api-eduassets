-- Record authorship: which user account created/edited/returned/resolved each record.
-- Purely additive: nullable columns, indexes and ON DELETE SET NULL foreign keys (deleting a user keeps the records).

-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN "criadoPorId" INTEGER;

-- AlterTable
ALTER TABLE "Equipamento" ADD COLUMN "atualizadoPorId" INTEGER,
ADD COLUMN "criadoPorId" INTEGER;

-- AlterTable
ALTER TABLE "Responsavel" ADD COLUMN "criadoPorId" INTEGER;

-- AlterTable
ALTER TABLE "Emprestimo" ADD COLUMN "atualizadoEm" TIMESTAMP(3),
ADD COLUMN "atualizadoPorId" INTEGER,
ADD COLUMN "criadoPorId" INTEGER,
ADD COLUMN "devolvidoPorId" INTEGER;

-- AlterTable
ALTER TABLE "Ocorrencia" ADD COLUMN "atualizadoEm" TIMESTAMP(3),
ADD COLUMN "atualizadoPorId" INTEGER,
ADD COLUMN "criadoPorId" INTEGER,
ADD COLUMN "resolvidoPorId" INTEGER;

-- CreateIndex
CREATE INDEX "Categoria_criadoPorId_idx" ON "Categoria"("criadoPorId");
CREATE INDEX "Equipamento_criadoPorId_idx" ON "Equipamento"("criadoPorId");
CREATE INDEX "Equipamento_atualizadoPorId_idx" ON "Equipamento"("atualizadoPorId");
CREATE INDEX "Responsavel_criadoPorId_idx" ON "Responsavel"("criadoPorId");
CREATE INDEX "Emprestimo_criadoPorId_idx" ON "Emprestimo"("criadoPorId");
CREATE INDEX "Emprestimo_atualizadoPorId_idx" ON "Emprestimo"("atualizadoPorId");
CREATE INDEX "Emprestimo_devolvidoPorId_idx" ON "Emprestimo"("devolvidoPorId");
CREATE INDEX "Ocorrencia_criadoPorId_idx" ON "Ocorrencia"("criadoPorId");
CREATE INDEX "Ocorrencia_atualizadoPorId_idx" ON "Ocorrencia"("atualizadoPorId");
CREATE INDEX "Ocorrencia_resolvidoPorId_idx" ON "Ocorrencia"("resolvidoPorId");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Responsavel" ADD CONSTRAINT "Responsavel_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Emprestimo" ADD CONSTRAINT "Emprestimo_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Emprestimo" ADD CONSTRAINT "Emprestimo_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Emprestimo" ADD CONSTRAINT "Emprestimo_devolvidoPorId_fkey" FOREIGN KEY ("devolvidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the audit trail (AuditLog is written in the same transaction as every mutation).
-- Rules: creator = actor of the earliest CREATE row; editor and edit time = actor and "createdAt" of the latest
-- UPDATE row; returner = actor of the latest RETURN row; resolver = actor of the latest RESOLVE row. Rows are matched
-- on "entity" and "entityId" = id::text. A column is only filled when such an audit row exists, its actor still
-- exists and the column is still NULL, so re-running these statements never overwrites data. Records without audit
-- rows (created before the audit trail existed, or by the seed) keep NULL authorship.

UPDATE "Categoria" AS r SET "criadoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Categoria' AND "action" = 'CREATE'
  ORDER BY "entityId", "createdAt" ASC, "id" ASC
) AS a
WHERE a."entityId" = r."id"::text AND r."criadoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Responsavel" AS r SET "criadoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Responsavel' AND "action" = 'CREATE'
  ORDER BY "entityId", "createdAt" ASC, "id" ASC
) AS a
WHERE a."entityId" = r."id"::text AND r."criadoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Equipamento" AS r SET "criadoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Equipamento' AND "action" = 'CREATE'
  ORDER BY "entityId", "createdAt" ASC, "id" ASC
) AS a
WHERE a."entityId" = r."id"::text AND r."criadoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Equipamento" AS r SET "atualizadoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Equipamento' AND "action" = 'UPDATE'
  ORDER BY "entityId", "createdAt" DESC, "id" DESC
) AS a
WHERE a."entityId" = r."id"::text AND r."atualizadoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Emprestimo" AS r SET "criadoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Emprestimo' AND "action" = 'CREATE'
  ORDER BY "entityId", "createdAt" ASC, "id" ASC
) AS a
WHERE a."entityId" = r."id"::text AND r."criadoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Emprestimo" AS r SET "atualizadoPorId" = a."actorId", "atualizadoEm" = a."createdAt"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId", "createdAt"
  FROM "AuditLog" WHERE "entity" = 'Emprestimo' AND "action" = 'UPDATE'
  ORDER BY "entityId", "createdAt" DESC, "id" DESC
) AS a
WHERE a."entityId" = r."id"::text AND r."atualizadoPorId" IS NULL AND r."atualizadoEm" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Emprestimo" AS r SET "devolvidoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Emprestimo' AND "action" = 'RETURN'
  ORDER BY "entityId", "createdAt" DESC, "id" DESC
) AS a
WHERE a."entityId" = r."id"::text AND r."devolvidoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Ocorrencia" AS r SET "criadoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Ocorrencia' AND "action" = 'CREATE'
  ORDER BY "entityId", "createdAt" ASC, "id" ASC
) AS a
WHERE a."entityId" = r."id"::text AND r."criadoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Ocorrencia" AS r SET "atualizadoPorId" = a."actorId", "atualizadoEm" = a."createdAt"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId", "createdAt"
  FROM "AuditLog" WHERE "entity" = 'Ocorrencia' AND "action" = 'UPDATE'
  ORDER BY "entityId", "createdAt" DESC, "id" DESC
) AS a
WHERE a."entityId" = r."id"::text AND r."atualizadoPorId" IS NULL AND r."atualizadoEm" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");

UPDATE "Ocorrencia" AS r SET "resolvidoPorId" = a."actorId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorId"
  FROM "AuditLog" WHERE "entity" = 'Ocorrencia' AND "action" = 'RESOLVE'
  ORDER BY "entityId", "createdAt" DESC, "id" DESC
) AS a
WHERE a."entityId" = r."id"::text AND r."resolvidoPorId" IS NULL
  AND EXISTS (SELECT 1 FROM "Usuario" AS u WHERE u."id" = a."actorId");
