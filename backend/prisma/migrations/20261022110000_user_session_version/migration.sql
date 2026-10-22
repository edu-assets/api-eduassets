-- Per-user session version enables durable JWT revocation across processes.
-- Existing users retain version 0; new sessions carry the current version.
ALTER TABLE "Usuario"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
