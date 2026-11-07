// Reportes del negocio para administración. Se calculan sobre las citas del periodo:
// para el volumen de una veterinaria (miles de citas al año) basta con traer pocas
// columnas y sumar aquí; si creciera mucho, estas cuentas pasarían a SQL.
const { diaSemana, fechaLocal, instante, sumarDias } = require('../citas/horario');

const ESTADOS = ['PENDIENTE', 'CONFIRMADA', 'ATENDIDA', 'NO_ASISTIO', 'CANCELADA'];
const DIAS_MAX = 366;

const diasEntre = (desde, hasta) => Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000) + 1;
const proporcion = (parte, total) => (total ? Math.round((parte / total) * 1000) / 1000 : null);

// Con muchos días, las barras se agrupan por semana o por mes para seguir siendo legibles.
const unidadPara = (dias) => (dias <= 31 ? 'dia' : dias <= 120 ? 'semana' : 'mes');
function inicioDe(fecha, unidad) {
  if (unidad === 'semana') return sumarDias(fecha, -((diaSemana(fecha) + 6) % 7)); // lunes
  if (unidad === 'mes') return `${fecha.slice(0, 7)}-01`;
  return fecha;
}
function siguiente(fecha, unidad) {
  if (unidad === 'dia') return sumarDias(fecha, 1);
  if (unidad === 'semana') return sumarDias(fecha, 7);
  const [a, m] = fecha.split('-').map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

async function resumen(prisma, desde, hasta) {
  const rango = { gte: instante(desde, 0), lt: instante(sumarDias(hasta, 1), 0) };
  const [citas, clientesNuevos] = await Promise.all([
    prisma.cita.findMany({ where: { inicio: rango }, select: { estado: true, inicio: true, origen: true, servicio: { select: { id: true, nombre: true, precioDesde: true } } } }),
    prisma.cliente.count({ where: { creadoEn: rango } }),
  ]);
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  citas.forEach((c) => { porEstado[c.estado] += 1; });
  const vigentes = citas.filter((c) => c.estado !== 'CANCELADA');
  const atendidas = citas.filter((c) => c.estado === 'ATENDIDA');
  return {
    citas, vigentes, atendidas, porEstado, clientesNuevos,
    totales: {
      citas: vigentes.length,
      atendidas: atendidas.length,
      // Estimado: la atención no guarda lo cobrado, así que se usa el precio base.
      ingresos: atendidas.reduce((suma, c) => suma + c.servicio.precioDesde, 0),
      clientesNuevos,
      inasistencia: proporcion(porEstado.NO_ASISTIO, porEstado.ATENDIDA + porEstado.NO_ASISTIO),
      cancelacion: proporcion(porEstado.CANCELADA, citas.length),
    },
  };
}

async function reporte(prisma, desde, hasta) {
  const dias = diasEntre(desde, hasta);
  const [actual, anterior] = await Promise.all([
    resumen(prisma, desde, hasta),
    resumen(prisma, sumarDias(desde, -dias), sumarDias(desde, -1)),
  ]);

  const porServicio = new Map();
  for (const c of actual.vigentes) {
    const fila = porServicio.get(c.servicio.id) || { nombre: c.servicio.nombre, citas: 0, atendidas: 0, ingresos: 0 };
    fila.citas += 1;
    if (c.estado === 'ATENDIDA') {
      fila.atendidas += 1;
      fila.ingresos += c.servicio.precioDesde;
    }
    porServicio.set(c.servicio.id, fila);
  }

  const unidad = unidadPara(dias);
  const puntos = new Map();
  for (let f = inicioDe(desde, unidad); f <= hasta; f = siguiente(f, unidad)) puntos.set(f, { desde: f, citas: 0, atendidas: 0 });
  for (const c of actual.vigentes) {
    const punto = puntos.get(inicioDe(fechaLocal(c.inicio), unidad));
    punto.citas += 1;
    if (c.estado === 'ATENDIDA') punto.atendidas += 1;
  }

  return {
    desde,
    hasta,
    ...actual.totales,
    porEstado: actual.porEstado,
    porServicio: [...porServicio.values()].sort((a, b) => b.citas - a.citas || a.nombre.localeCompare(b.nombre)),
    porOrigen: { WEB: actual.vigentes.filter((c) => c.origen !== 'WHATSAPP').length, WHATSAPP: actual.vigentes.filter((c) => c.origen === 'WHATSAPP').length },
    serie: { unidad, puntos: [...puntos.values()] },
    anterior: { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1), ...anterior.totales },
  };
}

module.exports = { DIAS_MAX, diasEntre, reporte };
