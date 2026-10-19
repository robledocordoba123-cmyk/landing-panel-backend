-- AlterTable
ALTER TABLE "Mensaje" ADD COLUMN     "atendidoEn" TIMESTAMP(3),
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'NUEVO',
ADD COLUMN     "mascota" TEXT,
ADD COLUMN     "servicio" TEXT;

-- CreateIndex
CREATE INDEX "Mensaje_estado_creadoEn_idx" ON "Mensaje"("estado", "creadoEn");
