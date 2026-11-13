-- Loan history pagination/filters and responsible-person activation flag.
-- Purely additive: existing rows become active (constant default, no table rewrite on PostgreSQL 11+), and the
-- composite index serves GET /emprestimos?paginado=1 (ORDER BY "dataRetirada" DESC, "id" DESC, keyset cursor,
-- de/ate range on "dataRetirada").

-- AlterTable
ALTER TABLE "Responsavel" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Emprestimo_dataRetirada_id_idx" ON "Emprestimo"("dataRetirada", "id");
