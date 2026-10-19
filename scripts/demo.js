// Datos de demostración: una cuenta del panel para la demo pública y algunas
// solicitudes de ejemplo. Borra las solicitudes anteriores, así que nunca se
// corre en un negocio real (exige DEMO=true).
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

if (process.env.DEMO !== 'true') {
  console.error('Este script borra solicitudes. Córrelo solo en la demo, con DEMO=true.');
  process.exit(1);
}

const prisma = new PrismaClient();
const HORA = 60 * 60 * 1000;
const hace = (horas) => new Date(Date.now() - horas * HORA);

const ejemplos = [
  { nombre: 'Laura Restrepo', email: 'laura@ejemplo.com', telefono: '300 000 0001', mascota: 'Toby (perro)', servicio: 'Vacunación', mensaje: 'Hola, quiero agendar la vacuna anual de Toby. ¿Tienen cita el sábado en la mañana?', creadoEn: hace(2) },
  { nombre: 'Andrés Gómez', email: 'andres@ejemplo.com', telefono: '300 000 0002', mascota: 'Misha (gata)', servicio: 'Consulta general', mensaje: 'Misha no quiere comer desde ayer. ¿Pueden revisarla hoy?', creadoEn: hace(5) },
  { nombre: 'Valentina Ríos', email: 'valentina@ejemplo.com', mascota: 'Coco (perro)', servicio: 'Peluquería', mensaje: '¿Cuánto cuesta el baño y corte para un poodle pequeño?', creadoEn: hace(26) },
  { nombre: 'Camilo Herrera', email: 'camilo@ejemplo.com', telefono: '300 000 0004', mascota: 'Luna (perra)', servicio: 'Consulta general', mensaje: 'Necesito el control después de la cirugía de Luna.', creadoEn: hace(50), estado: 'ATENDIDO', atendidoEn: hace(46) },
  { nombre: 'Sara Muñoz', email: 'sara@ejemplo.com', mascota: 'Kiwi (loro)', servicio: 'Otro', mensaje: '¿Atienden aves? Mi loro tiene las plumas raras.', creadoEn: hace(72), estado: 'ATENDIDO', atendidoEn: hace(70) },
];

(async () => {
  const hash = await bcrypt.hash('Huellitas2026!', 10);
  await prisma.usuario.upsert({ where: { email: 'admin@huellitas.demo' }, update: { password: hash }, create: { email: 'admin@huellitas.demo', password: hash } });
  await prisma.mensaje.deleteMany();
  await prisma.mensaje.createMany({ data: ejemplos });
  console.log(`Demo lista: ${ejemplos.length} solicitudes y la cuenta admin@huellitas.demo`);
  await prisma.$disconnect();
})();
