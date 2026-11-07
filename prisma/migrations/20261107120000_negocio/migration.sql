-- Horario y servicios editables desde el panel.

-- Un servicio se desactiva en vez de borrarse: hay citas que lo usan.
ALTER TABLE "Servicio" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Servicio" ADD CONSTRAINT "servicio_valores_validos"
  CHECK ("precioDesde" >= 0 AND "duracionMin" BETWEEN 15 AND 240 AND "duracionMin" % 15 = 0
         AND "recurso" IN ('CONSULTORIO', 'PELUQUERIA'));

-- Jornada de cada día: 0 = domingo ... 6 = sábado, y 7 = festivos.
-- Los minutos se cuentan desde la medianoche, en hora de Colombia.
CREATE TABLE "Jornada" (
    "dia" INTEGER NOT NULL,
    "abierto" BOOLEAN NOT NULL DEFAULT true,
    "abre" INTEGER NOT NULL,
    "cierra" INTEGER NOT NULL,
    CONSTRAINT "Jornada_pkey" PRIMARY KEY ("dia"),
    CONSTRAINT "jornada_valida" CHECK ("dia" BETWEEN 0 AND 7 AND "abre" >= 0 AND "cierra" <= 1440
                                       AND "abre" < "cierra" AND "abre" % 30 = 0 AND "cierra" % 30 = 0)
);

-- El mismo horario que tenía el código hasta ahora.
INSERT INTO "Jornada" ("dia", "abre", "cierra") VALUES
  (0, 540, 840), (1, 480, 1140), (2, 480, 1140), (3, 480, 1140),
  (4, 480, 1140), (5, 480, 1140), (6, 480, 1140), (7, 540, 840);

-- Días en que el negocio no abre (vacaciones, inventario...).
CREATE TABLE "Cierre" (
    "fecha" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cierre_pkey" PRIMARY KEY ("fecha")
);
