-- Loan scheduling (agendamentos): a loan whose checkout is in the future reserves units for the window
-- ["dataAgendada", "dataPrevistaDevolucao") without touching "quantidadeDisponivel"; confirming the pickup turns it
-- into an ABERTO loan. Purely additive: existing rows keep NULL in both new columns.

-- AlterEnum
-- PostgreSQL cannot use a value added by ALTER TYPE ... ADD VALUE inside the same transaction, so nothing below
-- compares "status" with the new enum value directly (the CHECK uses a text cast).
ALTER TYPE "StatusEmprestimo" ADD VALUE 'AGENDADO';

-- AlterTable
ALTER TABLE "Emprestimo" ADD COLUMN "dataAgendada" TIMESTAMP(3),
ADD COLUMN "dataPrevistaDevolucao" TIMESTAMP(3);

-- Expected return must come after the checkout (scheduled start while AGENDADO, actual pickup afterwards).
ALTER TABLE "Emprestimo"
  ADD CONSTRAINT "Emprestimo_dataPrevistaDevolucao_check"
  CHECK ("dataPrevistaDevolucao" IS NULL OR "dataPrevistaDevolucao" > "dataRetirada");

-- A schedule always has a complete window.
ALTER TABLE "Emprestimo"
  ADD CONSTRAINT "Emprestimo_agendado_janela_check"
  CHECK ("status"::text <> 'AGENDADO' OR ("dataAgendada" IS NOT NULL AND "dataPrevistaDevolucao" IS NOT NULL));

-- CreateIndex
CREATE INDEX "Emprestimo_status_dataAgendada_idx" ON "Emprestimo"("status", "dataAgendada");
