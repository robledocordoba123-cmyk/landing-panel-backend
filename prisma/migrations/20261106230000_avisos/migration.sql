-- Evita enviar dos veces el recordatorio de una misma cita.
ALTER TABLE "Cita" ADD COLUMN "recordatorioEn" TIMESTAMP(3);

-- Registro de cada correo: qué se envió, a quién y cómo terminó.
CREATE TABLE "Notificacion" (
    "id" SERIAL NOT NULL,
    "citaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "detalle" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notificacion_citaId_idx" ON "Notificacion"("citaId");
CREATE INDEX "Notificacion_creadoEn_idx" ON "Notificacion"("creadoEn");

ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notificacion" ADD CONSTRAINT "notificacion_estado_valido" CHECK ("estado" IN ('ENVIADA', 'SIMULADA', 'FALLIDA'));
