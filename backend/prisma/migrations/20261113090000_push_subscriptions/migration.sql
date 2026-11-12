-- Web Push notifications for administrators: one row per subscribed browser/device.
-- No user agent or IP is stored; deleting a user removes its subscriptions.
CREATE TABLE "PushSubscription" (
  "id" SERIAL NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "notificarEmprestimo" BOOLEAN NOT NULL DEFAULT true,
  "notificarDevolucao" BOOLEAN NOT NULL DEFAULT true,
  "notificarOcorrencia" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_usuarioId_idx" ON "PushSubscription"("usuarioId");
