-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mascota" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "especie" TEXT NOT NULL,
    "raza" TEXT,
    "sexo" TEXT,
    "fechaNacimiento" DATE,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mascota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Atencion" (
    "id" SERIAL NOT NULL,
    "mascotaId" INTEGER NOT NULL,
    "citaId" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT NOT NULL,
    "diagnostico" TEXT,
    "tratamiento" TEXT,
    "pesoKg" DOUBLE PRECISION,
    "temperaturaC" DOUBLE PRECISION,
    "registradoPor" TEXT NOT NULL,

    CONSTRAINT "Atencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vacuna" (
    "id" SERIAL NOT NULL,
    "mascotaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "aplicadaEn" DATE NOT NULL,
    "proximaDosis" DATE,
    "lote" TEXT,
    "registradoPor" TEXT NOT NULL,

    CONSTRAINT "Vacuna_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_email_key" ON "Cliente"("email");
CREATE INDEX "Mascota_clienteId_idx" ON "Mascota"("clienteId");
CREATE UNIQUE INDEX "Atencion_citaId_key" ON "Atencion"("citaId");
CREATE INDEX "Atencion_mascotaId_fecha_idx" ON "Atencion"("mascotaId", "fecha");
CREATE INDEX "Vacuna_mascotaId_idx" ON "Vacuna"("mascotaId");
CREATE INDEX "Vacuna_proximaDosis_idx" ON "Vacuna"("proximaDosis");

-- AddForeignKey
ALTER TABLE "Mascota" ADD CONSTRAINT "Mascota_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Atencion" ADD CONSTRAINT "Atencion_mascotaId_fkey" FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Atencion" ADD CONSTRAINT "Atencion_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vacuna" ADD CONSTRAINT "Vacuna_mascotaId_fkey" FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las citas que ya existen pasan a apuntar a un cliente y una mascota, sin perder datos.
INSERT INTO "Cliente" ("nombre", "email", "telefono")
SELECT DISTINCT ON ("email") "nombre", "email", "telefono" FROM "Cita" ORDER BY "email", "creadoEn" DESC;

INSERT INTO "Mascota" ("clienteId", "nombre", "especie")
SELECT DISTINCT cl."id", c."mascota", 'Otro' FROM "Cita" c JOIN "Cliente" cl ON cl."email" = c."email";

ALTER TABLE "Cita" ADD COLUMN "mascotaId" INTEGER;

UPDATE "Cita" c SET "mascotaId" = m."id"
FROM "Cliente" cl JOIN "Mascota" m ON m."clienteId" = cl."id"
WHERE cl."email" = c."email" AND m."nombre" = c."mascota";

ALTER TABLE "Cita" ALTER COLUMN "mascotaId" SET NOT NULL;
ALTER TABLE "Cita" DROP COLUMN "nombre", DROP COLUMN "email", DROP COLUMN "telefono", DROP COLUMN "mascota";

CREATE INDEX "Cita_mascotaId_idx" ON "Cita"("mascotaId");
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_mascotaId_fkey" FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que no dependen de la aplicación.
ALTER TABLE "Mascota" ADD CONSTRAINT "mascota_especie_valida" CHECK ("especie" IN ('Perro', 'Gato', 'Ave', 'Conejo', 'Otro'));
ALTER TABLE "Vacuna" ADD CONSTRAINT "vacuna_proxima_dosis_futura" CHECK ("proximaDosis" IS NULL OR "proximaDosis" > "aplicadaEn");
