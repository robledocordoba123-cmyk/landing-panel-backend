// Datos de demostración: una cuenta del panel para la demo pública, solicitudes
// y citas de ejemplo. Borra las anteriores, así que nunca se corre en un negocio
// real (exige DEMO=true).
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { CALENDARIO_POR_DEFECTO, fechaLocal, finDe, instante, jornadaDe, sumarDias } = require('../citas/horario');
const { asegurarMascota } = require('../clientes/mascotas');

if (process.env.DEMO !== 'true') {
  console.error('Este script borra solicitudes. Córrelo solo en la demo, con DEMO=true.');
  process.exit(1);
}

const prisma = new PrismaClient();
const CUENTAS_DEMO = [
  { email: 'admin@huellitas.demo', nombre: 'Sofía Vélez', rol: 'ADMIN' },
  { email: 'vet@huellitas.demo', nombre: 'Dr. Mateo Ríos', rol: 'VETERINARIO' },
  { email: 'recepcion@huellitas.demo', nombre: 'Juliana Arias', rol: 'RECEPCION' },
];
const HORA = 60 * 60 * 1000;
const hace = (horas) => new Date(Date.now() - horas * HORA);

const ejemplos = [
  { nombre: 'Laura Restrepo', email: 'laura@ejemplo.com', telefono: '300 000 0001', mascota: 'Toby (perro)', servicio: 'Vacunación', mensaje: 'Hola, quiero agendar la vacuna anual de Toby. ¿Tienen cita el sábado en la mañana?', creadoEn: hace(2) },
  { nombre: 'Paola Arango', email: 'paola@ejemplo.com', telefono: '573000000005', mascota: 'Max, perro', servicio: 'Peluquería', mensaje: 'Cita de Peluquería pedida por WhatsApp.', origen: 'WHATSAPP', creadoEn: hace(1) },
  { nombre: 'Andrés Gómez', email: 'andres@ejemplo.com', telefono: '300 000 0002', mascota: 'Misha (gata)', servicio: 'Consulta general', mensaje: 'Misha no quiere comer desde ayer. ¿Pueden revisarla hoy?', creadoEn: hace(5) },
  { nombre: 'Valentina Ríos', email: 'valentina@ejemplo.com', mascota: 'Coco (perro)', servicio: 'Peluquería', mensaje: '¿Cuánto cuesta el baño y corte para un poodle pequeño?', creadoEn: hace(26) },
  { nombre: 'Camilo Herrera', email: 'camilo@ejemplo.com', telefono: '300 000 0004', mascota: 'Luna (perra)', servicio: 'Consulta general', mensaje: 'Necesito el control después de la cirugía de Luna.', creadoEn: hace(50), estado: 'ATENDIDO', atendidoEn: hace(46) },
  { nombre: 'Sara Muñoz', email: 'sara@ejemplo.com', mascota: 'Kiwi (loro)', servicio: 'Otro', mensaje: '¿Atienden aves? Mi loro tiene las plumas raras.', creadoEn: hace(72), estado: 'ATENDIDO', atendidoEn: hace(70) },
];

// Citas alrededor de hoy, para que la agenda nunca se vea vacía. Las horas caben
// también en la jornada corta de domingos y festivos (9:00 a. m. a 2:00 p. m.).
const citasDeEjemplo = [
  { dia: -1, hora: 9, servicio: 'Consulta general', nombre: 'Camilo Herrera', email: 'camilo@ejemplo.com', telefono: '300 000 0004', mascota: 'Luna', especie: 'Perro', estado: 'ATENDIDA' },
  { dia: -1, hora: 10, servicio: 'Vacunación', nombre: 'Sara Muñoz', email: 'sara@ejemplo.com', telefono: '300 000 0006', mascota: 'Nala', especie: 'Gato', estado: 'NO_ASISTIO' },
  { dia: 0, hora: 9, servicio: 'Vacunación', nombre: 'Laura Restrepo', email: 'laura@ejemplo.com', telefono: '300 000 0001', mascota: 'Toby', especie: 'Perro', estado: 'CONFIRMADA', notas: 'Vacuna anual.' },
  { dia: 0, hora: 10, servicio: 'Peluquería', nombre: 'Valentina Ríos', email: 'valentina@ejemplo.com', telefono: '300 000 0003', mascota: 'Coco', especie: 'Perro', estado: 'CONFIRMADA' },
  { dia: 0, hora: 11, servicio: 'Consulta general', nombre: 'Andrés Gómez', email: 'andres@ejemplo.com', telefono: '300 000 0002', mascota: 'Misha', especie: 'Gato', estado: 'PENDIENTE', notas: 'No quiere comer desde ayer.' },
  { dia: 1, hora: 9, servicio: 'Consulta general', nombre: 'Paola Arango', email: 'paola@ejemplo.com', telefono: '573000000005', mascota: 'Max', especie: 'Perro', estado: 'PENDIENTE', origen: 'WHATSAPP' },
  { dia: 1, hora: 11, servicio: 'Peluquería', nombre: 'Daniela Mejía', email: 'daniela@ejemplo.com', telefono: '300 000 0007', mascota: 'Rocky', especie: 'Perro', estado: 'CONFIRMADA' },
];

const diaUtc = (fecha) => new Date(`${fecha}T00:00:00Z`);

// La demo es pública y administración puede cambiar el horario y los servicios: cada
// arranque los devuelve a como nacen, para que nadie la deje cerrada.
const SERVICIOS_BASE = [
  { nombre: 'Consulta general', detalle: 'revisión completa y tratamiento', precioDesde: 60000, duracionMin: 30, recurso: 'CONSULTORIO', reservable: true },
  { nombre: 'Vacunación', detalle: 'plan de vacunas y desparasitación', precioDesde: 45000, duracionMin: 30, recurso: 'CONSULTORIO', reservable: true },
  { nombre: 'Peluquería', detalle: 'baño, corte, oídos y uñas', precioDesde: 50000, duracionMin: 90, recurso: 'PELUQUERIA', reservable: true },
  { nombre: 'Urgencias', detalle: 'atención prioritaria todos los días', precioDesde: 90000, duracionMin: 30, recurso: 'CONSULTORIO', reservable: false },
];

async function restablecerNegocio() {
  await prisma.cierre.deleteMany();
  for (const [dia, jornada] of CALENDARIO_POR_DEFECTO.jornadas) {
    await prisma.jornada.upsert({ where: { dia }, update: jornada, create: { dia, ...jornada } });
  }
  for (const servicio of SERVICIOS_BASE) {
    await prisma.servicio.upsert({ where: { nombre: servicio.nombre }, update: { ...servicio, activo: true }, create: servicio });
  }
  await prisma.servicio.deleteMany({ where: { nombre: { notIn: SERVICIOS_BASE.map((s) => s.nombre) } } });
}

// Generador con semilla fija: el historial sale igual en cada arranque.
function azar(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// Ocho semanas de citas pasadas, para que los reportes muestren algo con sentido.
async function crearHistorial(servicios) {
  const hoy = fechaLocal(new Date());
  const mascotas = await prisma.mascota.findMany({ select: { id: true, clienteId: true } });
  const reservables = servicios.filter((s) => s.reservable);
  const numero = azar(2026);
  const citas = [];
  for (let dia = -56; dia <= -2; dia += 1) {
    const fecha = sumarDias(hoy, dia);
    const jornada = jornadaDe(fecha);
    const cuantas = Math.floor(numero() * (jornada.cierra - jornada.abre > 360 ? 6 : 3));
    const libre = { CONSULTORIO: jornada.abre, PELUQUERIA: jornada.abre };
    for (let i = 0; i < cuantas; i += 1) {
      const servicio = reservables[Math.floor(numero() * reservables.length)];
      const minuto = libre[servicio.recurso];
      if (minuto + servicio.duracionMin > jornada.cierra) continue;
      libre[servicio.recurso] = minuto + servicio.duracionMin + 30 * Math.floor(numero() * 3);
      const suerte = numero();
      const inicio = instante(fecha, minuto);
      citas.push({
        servicioId: servicio.id, recurso: servicio.recurso, inicio, fin: finDe(inicio, servicio.duracionMin),
        mascotaId: mascotas[Math.floor(numero() * mascotas.length)].id,
        estado: suerte < 0.78 ? 'ATENDIDA' : suerte < 0.88 ? 'NO_ASISTIO' : 'CANCELADA',
        origen: numero() < 0.3 ? 'WHATSAPP' : 'WEB',
      });
    }
  }
  await prisma.cita.createMany({ data: citas });
  // Cada cliente "llegó" el día de su primera cita.
  for (const { clienteId } of mascotas) {
    const primera = await prisma.cita.findFirst({ where: { mascota: { clienteId } }, orderBy: { inicio: 'asc' } });
    if (primera) await prisma.cliente.update({ where: { id: clienteId }, data: { creadoEn: primera.inicio } });
  }
  return citas.length;
}

async function crearCitasDeEjemplo() {
  const hoy = fechaLocal(new Date());
  await prisma.atencion.deleteMany();
  await prisma.vacuna.deleteMany();
  await prisma.cita.deleteMany();
  await prisma.mascota.deleteMany();
  await prisma.cliente.deleteMany();
  await restablecerNegocio();
  const servicios = await prisma.servicio.findMany();

  for (const { dia, hora, servicio: nombreServicio, nombre, email, telefono, mascota, especie, ...cita } of citasDeEjemplo) {
    const servicio = servicios.find((s) => s.nombre === nombreServicio);
    const inicio = instante(sumarDias(hoy, dia), hora * 60);
    const { id: mascotaId } = await asegurarMascota(prisma, { nombre, email, telefono, mascota, especie });
    await prisma.cita.create({ data: { ...cita, mascotaId, servicioId: servicio.id, recurso: servicio.recurso, inicio, fin: finDe(inicio, servicio.duracionMin) } });
  }

  // Historia y carné de ejemplo: Toby con una vacuna por vencer, Luna con su control.
  const toby = await prisma.mascota.findFirst({ where: { nombre: 'Toby' } });
  const luna = await prisma.mascota.findFirst({ where: { nombre: 'Luna' } });
  const registradoPor = 'admin@huellitas.demo';
  await prisma.mascota.update({ where: { id: toby.id }, data: { raza: 'Criollo', sexo: 'Macho', fechaNacimiento: diaUtc(sumarDias(hoy, -1200)) } });
  await prisma.vacuna.createMany({
    data: [
      { mascotaId: toby.id, nombre: 'Rabia', aplicadaEn: diaUtc(sumarDias(hoy, -350)), proximaDosis: diaUtc(sumarDias(hoy, 15)), lote: 'RB-2231', registradoPor },
      { mascotaId: toby.id, nombre: 'Moquillo y parvovirus', aplicadaEn: diaUtc(sumarDias(hoy, -40)), proximaDosis: diaUtc(sumarDias(hoy, 325)), lote: 'MP-1180', registradoPor },
      { mascotaId: luna.id, nombre: 'Rabia', aplicadaEn: diaUtc(sumarDias(hoy, -400)), proximaDosis: diaUtc(sumarDias(hoy, -35)), lote: 'RB-2102', registradoPor },
    ],
  });
  const citaLuna = await prisma.cita.findFirst({ where: { mascotaId: luna.id, estado: 'ATENDIDA' } });
  await prisma.atencion.create({
    data: { mascotaId: luna.id, citaId: citaLuna.id, fecha: citaLuna.inicio, motivo: 'Control después de cirugía', diagnostico: 'Cicatrización normal, sin signos de infección.', tratamiento: 'Retirar puntos en 7 días. Mantener el collar isabelino.', pesoKg: 18.4, temperaturaC: 38.5, registradoPor },
  });
  return crearHistorial(servicios);
}

(async () => {
  const hash = await bcrypt.hash('Huellitas2026!', 10);
  // Una cuenta por rol, para probar lo que ve cada quien.
  for (const cuenta of CUENTAS_DEMO) {
    await prisma.usuario.upsert({ where: { email: cuenta.email }, update: { ...cuenta, password: hash, activo: true }, create: { ...cuenta, password: hash } });
  }
  await prisma.conversacionBot.deleteMany();
  await prisma.mensaje.deleteMany();
  await prisma.mensaje.createMany({ data: ejemplos });
  const historial = await crearCitasDeEjemplo();
  console.log(`Demo lista: ${ejemplos.length} solicitudes, ${citasDeEjemplo.length} citas, ${historial} de historial y la cuenta admin@huellitas.demo`);
  await prisma.$disconnect();
})();
