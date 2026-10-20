-- AlterTable
ALTER TABLE "Mensaje" ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "ConversacionBot" (
    "id" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'INICIO',
    "datos" JSONB NOT NULL DEFAULT '{}',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversacionBot_pkey" PRIMARY KEY ("id")
);
