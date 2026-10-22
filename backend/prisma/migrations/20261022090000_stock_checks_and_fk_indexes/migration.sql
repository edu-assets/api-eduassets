-- Add local stock invariants and indexes used by stock reconciliation queries.
-- Existing invalid rows intentionally fail this migration instead of being altered implicitly.
ALTER TABLE "Equipamento"
  ADD CONSTRAINT "Equipamento_stock_quantities_check"
  CHECK (
    "quantidadeTotal" >= 0
    AND "quantidadeDisponivel" >= 0
    AND "quantidadeQuebrada" >= 0
    AND "quantidadeDisponivel" + "quantidadeQuebrada" <= "quantidadeTotal"
  );

ALTER TABLE "ItemEmprestimo"
  ADD CONSTRAINT "ItemEmprestimo_quantidade_positive_check"
  CHECK ("quantidade" > 0);

CREATE INDEX "Equipamento_quantidadeDisponivel_idx"
  ON "Equipamento"("quantidadeDisponivel");
CREATE INDEX "Equipamento_quantidadeQuebrada_idx"
  ON "Equipamento"("quantidadeQuebrada");
CREATE INDEX "ItemEmprestimo_emprestimoId_idx"
  ON "ItemEmprestimo"("emprestimoId");
CREATE INDEX "ItemEmprestimo_equipamentoId_emprestimoId_idx"
  ON "ItemEmprestimo"("equipamentoId", "emprestimoId");
CREATE INDEX "Ocorrencia_equipamentoId_status_tipo_idx"
  ON "Ocorrencia"("equipamentoId", "status", "tipo");
