-- Equipo: cada persona con su cuenta y su rol. Las cuentas que ya existen son
-- las de quien administra el negocio, así que quedan como ADMIN.
ALTER TABLE "Usuario" ADD COLUMN "nombre" TEXT NOT NULL DEFAULT 'Administración';
ALTER TABLE "Usuario" ADD COLUMN "rol" TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "Usuario" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Usuario" ADD COLUMN "sesionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Usuario" ADD COLUMN "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Usuario" ALTER COLUMN "nombre" DROP DEFAULT;
ALTER TABLE "Usuario" ALTER COLUMN "rol" SET DEFAULT 'RECEPCION';
ALTER TABLE "Usuario" ADD CONSTRAINT "usuario_rol_valido" CHECK ("rol" IN ('ADMIN', 'VETERINARIO', 'RECEPCION'));

-- Bitácora: no tiene llave foránea a propósito, debe sobrevivir a cualquier cuenta.
CREATE TABLE "Bitacora" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "usuarioEmail" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT,
    "entidadId" INTEGER,
    "detalle" TEXT,
    "ip" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bitacora_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Bitacora_creadoEn_idx" ON "Bitacora"("creadoEn");
CREATE INDEX "Bitacora_entidad_entidadId_idx" ON "Bitacora"("entidad", "entidadId");

-- La bitácora solo crece: ni la aplicación puede cambiarla o borrarla a escondidas.
CREATE FUNCTION bitacora_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora no se puede modificar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bitacora_sin_cambios BEFORE UPDATE OR DELETE ON "Bitacora"
  FOR EACH ROW EXECUTE FUNCTION bitacora_inmutable();

-- Autorización de tratamiento de datos (Ley 1581 de 2012): prueba de cuándo, con
-- qué versión de la política y por qué canal se dio.
CREATE TABLE "AutorizacionDatos" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "ip" TEXT,
    "aceptadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutorizacionDatos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutorizacionDatos_clienteId_idx" ON "AutorizacionDatos"("clienteId");
ALTER TABLE "AutorizacionDatos" ADD CONSTRAINT "AutorizacionDatos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Cliente" ADD COLUMN "anonimizadoEn" TIMESTAMP(3);
ALTER TABLE "Mensaje" ADD COLUMN "autorizaDatosEn" TIMESTAMP(3);
