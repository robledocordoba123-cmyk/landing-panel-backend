-- btree_gist permite combinar "mismo recurso" con "horarios que se cruzan".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "Servicio" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "precioDesde" INTEGER NOT NULL,
    "duracionMin" INTEGER NOT NULL,
    "recurso" TEXT NOT NULL,
    "reservable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cita" (
    "id" SERIAL NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "recurso" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "mascota" TEXT NOT NULL,
    "notas" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'WEB',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Servicio_nombre_key" ON "Servicio"("nombre");
CREATE INDEX "Cita_inicio_idx" ON "Cita"("inicio");
CREATE INDEX "Cita_email_estado_idx" ON "Cita"("email", "estado");

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dos citas del mismo recurso no pueden cruzarse. Lo garantiza la base de datos,
-- así se cumple aunque dos personas reserven en el mismo instante. Una cita
-- cancelada libera su horario.
ALTER TABLE "Cita" ADD CONSTRAINT "cita_sin_cruces"
  EXCLUDE USING gist ("recurso" WITH =, tsrange("inicio", "fin", '[)') WITH &&)
  WHERE ("estado" <> 'CANCELADA');

ALTER TABLE "Cita" ADD CONSTRAINT "cita_estado_valido"
  CHECK ("estado" IN ('PENDIENTE', 'CONFIRMADA', 'ATENDIDA', 'NO_ASISTIO', 'CANCELADA'));
ALTER TABLE "Cita" ADD CONSTRAINT "cita_fin_despues_de_inicio" CHECK ("fin" > "inicio");

-- Servicios iniciales.
INSERT INTO "Servicio" ("nombre", "detalle", "precioDesde", "duracionMin", "recurso", "reservable") VALUES
  ('Consulta general', 'revisión completa y tratamiento', 60000, 30, 'CONSULTORIO', true),
  ('Vacunación', 'plan de vacunas y desparasitación', 45000, 30, 'CONSULTORIO', true),
  ('Peluquería', 'baño, corte, oídos y uñas', 50000, 90, 'PELUQUERIA', true),
  ('Urgencias', 'atención prioritaria todos los días', 90000, 30, 'CONSULTORIO', false);
