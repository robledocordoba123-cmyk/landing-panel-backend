// Clientes, mascotas e historia clínica. Lo que se escribe aquí es información
// de salud y de contacto: solo se llega desde rutas protegidas del panel.
const { ErrorAgenda } = require('../citas/agenda');
const { fechaLocal, sumarDias } = require('../citas/horario');
const { totalPaginas } = require('../plataforma/paginacion');

const POR_PAGINA = 20;

// Búsqueda por nombre, correo, teléfono o nombre de la mascota.
async function buscarClientes(prisma, q, pagina = 1) {
  const texto = (q || '').trim();
  const contiene = { contains: texto, mode: 'insensitive' };
  const where = texto ? { OR: [{ nombre: contiene }, { email: contiene }, { telefono: contiene }, { mascotas: { some: { nombre: contiene } } }] } : {};
  const [clientes, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      // El id desempata: sin él, dos nombres iguales podrían repetirse entre páginas.
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      include: { mascotas: { select: { id: true, nombre: true, especie: true }, orderBy: { nombre: 'asc' } } },
    }),
    prisma.cliente.count({ where }),
  ]);
  return { clientes, pagina, paginas: totalPaginas(total, POR_PAGINA), total };
}

async function detalleCliente(prisma, id) {
  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: { mascotas: { orderBy: { nombre: 'asc' } } },
  });
  if (!cliente) throw new ErrorAgenda('El cliente no existe', 404);
  return cliente;
}

// La historia clínica solo se incluye para quien tiene permiso de leerla.
async function fichaMascota(prisma, id, { conHistoria }) {
  const mascota = await prisma.mascota.findUnique({
    where: { id },
    include: {
      cliente: true,
      ...(conHistoria ? { atenciones: { orderBy: { fecha: 'desc' } } } : {}),
      vacunas: { orderBy: { aplicadaEn: 'desc' } },
      citas: { orderBy: { inicio: 'desc' }, take: 10, include: { servicio: { select: { nombre: true } } } },
    },
  });
  if (!mascota) throw new ErrorAgenda('La mascota no existe', 404);
  return mascota;
}

// Si la atención viene de una cita, la cita pasa a ATENDIDA en la misma
// transacción: nunca queda una cita atendida sin su registro, ni al revés.
function registrarAtencion(prisma, mascotaId, { citaId, ...datos }, registradoPor, ahora = new Date()) {
  return prisma.$transaction(async (tx) => {
    const mascota = await tx.mascota.findUnique({ where: { id: mascotaId }, select: { id: true } });
    if (!mascota) throw new ErrorAgenda('La mascota no existe', 404);
    if (citaId) {
      const { count } = await tx.cita.updateMany({
        where: { id: citaId, mascotaId, estado: 'CONFIRMADA', inicio: { lte: ahora } },
        data: { estado: 'ATENDIDA' },
      });
      if (!count) throw new ErrorAgenda('Esa cita no se puede atender: debe estar confirmada y haber empezado.');
    }
    return tx.atencion.create({ data: { ...datos, mascotaId, citaId: citaId || null, registradoPor } });
  });
}

async function registrarVacuna(prisma, mascotaId, datos, registradoPor) {
  const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId }, select: { id: true } });
  if (!mascota) throw new ErrorAgenda('La mascota no existe', 404);
  return prisma.vacuna.create({ data: { ...datos, mascotaId, registradoPor } });
}

// Derecho de supresión (Ley 1581): borra los datos de la persona y cancela sus
// citas futuras. La historia de la mascota se conserva porque la ley exige
// guardar los registros clínicos; sin datos de contacto ya no identifica a nadie.
async function suprimirCliente(prisma, id, ahora = new Date()) {
  await prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.findUnique({ where: { id } });
    if (!cliente) throw new ErrorAgenda('El cliente no existe', 404);
    if (cliente.anonimizadoEn) throw new ErrorAgenda('Los datos de este cliente ya fueron suprimidos.');
    const correoAnonimo = `suprimido-${id}@datos.invalid`;
    await tx.cliente.update({ where: { id }, data: { nombre: 'Datos suprimidos', email: correoAnonimo, telefono: null, anonimizadoEn: ahora } });
    await tx.mensaje.deleteMany({ where: { email: cliente.email } });
    await tx.notificacion.updateMany({ where: { destinatario: cliente.email }, data: { destinatario: correoAnonimo } });
    await tx.cita.updateMany({
      where: { mascota: { clienteId: id }, inicio: { gt: ahora }, estado: { in: ['PENDIENTE', 'CONFIRMADA'] } },
      data: { estado: 'CANCELADA' },
    });
  });
}

// Vacunas vencidas o que vencen pronto. Si la mascota ya recibió una dosis más
// reciente de la misma vacuna, la anterior deja de contar.
async function vacunasPorVencer(prisma, dias, ahora = new Date()) {
  const limite = new Date(`${sumarDias(fechaLocal(ahora), dias)}T00:00:00Z`);
  const candidatas = await prisma.vacuna.findMany({
    where: { proximaDosis: { lte: limite } },
    orderBy: { proximaDosis: 'asc' },
    include: { mascota: { include: { cliente: { select: { id: true, nombre: true, telefono: true } } } } },
  });
  if (!candidatas.length) return [];
  const todas = await prisma.vacuna.findMany({
    where: { mascotaId: { in: [...new Set(candidatas.map((v) => v.mascotaId))] } },
    select: { mascotaId: true, nombre: true, aplicadaEn: true },
  });
  const mismaVacuna = (a, b) => a.mascotaId === b.mascotaId && a.nombre.toLowerCase() === b.nombre.toLowerCase();
  return candidatas.filter((v) => !todas.some((o) => mismaVacuna(o, v) && o.aplicadaEn > v.aplicadaEn));
}

module.exports = { buscarClientes, detalleCliente, fichaMascota, registrarAtencion, registrarVacuna, suprimirCliente, vacunasPorVencer };
