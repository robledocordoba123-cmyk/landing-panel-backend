// Lógica de la agenda. La usan la página, el panel y el asistente de WhatsApp,
// para que las reglas sean las mismas sin importar por dónde llegue la cita.
const { fechaLocal, finDe, horariosPosibles, instante, sumarDias } = require('./horario');
const { asegurarMascota } = require('../clientes/mascotas');

const MAX_CITAS_ACTIVAS = 3; // por correo, para que nadie llene la agenda

// A qué estados puede pasar una cita desde cada estado.
const TRANSICIONES = {
  PENDIENTE: ['CONFIRMADA', 'CANCELADA'],
  CONFIRMADA: ['ATENDIDA', 'NO_ASISTIO', 'CANCELADA'],
  ATENDIDA: [],
  NO_ASISTIO: [],
  CANCELADA: [],
};
const ESTADOS = Object.keys(TRANSICIONES);

// Error de una regla del negocio: la API lo devuelve tal cual a quien reserva.
class ErrorAgenda extends Error {
  constructor(mensaje, estado = 409) {
    super(mensaje);
    this.estado = estado;
  }
}

const seCruza = (a, b) => a.inicio < b.fin && b.inicio < a.fin;

// Citas que ocupan un recurso en un día (las canceladas ya no ocupan nada).
function ocupadas(prisma, recurso, fecha) {
  return prisma.cita.findMany({
    where: {
      recurso,
      estado: { not: 'CANCELADA' },
      inicio: { lt: instante(sumarDias(fecha, 1), 0) },
      fin: { gt: instante(fecha, 0) },
    },
    select: { inicio: true, fin: true },
  });
}

async function disponibilidad(prisma, servicio, fecha, ahora = new Date()) {
  const posibles = horariosPosibles(fecha, servicio.duracionMin, ahora);
  if (!posibles.length) return [];
  const citas = await ocupadas(prisma, servicio.recurso, fecha);
  return posibles.filter((inicio) => !citas.some((c) => seCruza({ inicio, fin: finDe(inicio, servicio.duracionMin) }, c)));
}

// La restricción cita_sin_cruces de PostgreSQL rechaza la cita (código 23P01).
const esCruce = (err) => /23P01|cita_sin_cruces/.test(err.message || '');

async function crearCita(prisma, { servicio, inicio, nombre, email, telefono, mascota, especie, notas, origen = 'WEB' }, ahora = new Date()) {
  if (!servicio.reservable) throw new ErrorAgenda('Las urgencias se atienden sin cita: ven directamente.', 400);

  const permitido = horariosPosibles(fechaLocal(inicio), servicio.duracionMin, ahora).some((h) => h.getTime() === inicio.getTime());
  if (!permitido) throw new ErrorAgenda('Ese horario no está disponible. Elige otro, por favor.', 400);

  const activas = await prisma.cita.count({ where: { mascota: { cliente: { email } }, estado: { in: ['PENDIENTE', 'CONFIRMADA'] }, inicio: { gt: ahora } } });
  if (activas >= MAX_CITAS_ACTIVAS) throw new ErrorAgenda(`Ya tienes ${MAX_CITAS_ACTIVAS} citas pendientes con ese correo. Escríbenos si necesitas otra.`);

  try {
    // Todo o nada: si el horario se pierde, no queda un cliente suelto.
    return await prisma.$transaction(async (tx) => {
      const { id: mascotaId } = await asegurarMascota(tx, { nombre, email, telefono, mascota, especie });
      return tx.cita.create({
        data: { servicioId: servicio.id, recurso: servicio.recurso, inicio, fin: finDe(inicio, servicio.duracionMin), mascotaId, notas, origen },
        include: { servicio: true },
      });
    });
  } catch (err) {
    if (esCruce(err)) throw new ErrorAgenda('Alguien acaba de reservar ese horario. Elige otro, por favor.');
    if (err.code === 'P2002') throw new ErrorAgenda('Estamos guardando otra reserva con ese correo. Intenta de nuevo.');
    throw err;
  }
}

async function cambiarEstado(prisma, id, nuevo, ahora = new Date()) {
  if (!ESTADOS.includes(nuevo)) throw new ErrorAgenda('Estado no válido', 400);
  const cita = await prisma.cita.findUnique({ where: { id } });
  if (!cita) throw new ErrorAgenda('La cita no existe', 404);
  if (!TRANSICIONES[cita.estado].includes(nuevo)) throw new ErrorAgenda('La cita no puede pasar a ese estado.');
  if (['ATENDIDA', 'NO_ASISTIO'].includes(nuevo) && cita.inicio > ahora) throw new ErrorAgenda('La cita todavía no ha empezado.');

  // El estado anterior va en la condición: si otra persona la cambió justo
  // ahora, no se pisa su cambio.
  const { count } = await prisma.cita.updateMany({ where: { id, estado: cita.estado }, data: { estado: nuevo } });
  if (!count) throw new ErrorAgenda('Otra persona acaba de cambiar esta cita. Actualiza la agenda.');
  return prisma.cita.findUnique({ where: { id }, include: { servicio: true } });
}

function citasEntre(prisma, desde, hasta) {
  return prisma.cita.findMany({
    where: { inicio: { gte: instante(desde, 0), lt: instante(sumarDias(hasta, 1), 0) } },
    orderBy: { inicio: 'asc' },
    include: {
      servicio: { select: { nombre: true, duracionMin: true } },
      mascota: { select: { id: true, nombre: true, especie: true, cliente: { select: { id: true, nombre: true, email: true, telefono: true } } } },
    },
  });
}

module.exports = { ErrorAgenda, ESTADOS, TRANSICIONES, MAX_CITAS_ACTIVAS, disponibilidad, crearCita, cambiarEstado, citasEntre, esCruce };
