// Ajustes del negocio: horario, días cerrados y servicios. Leer el horario es
// público (lo muestra la página); cambiar cualquier cosa es solo de administración.
const express = require('express');
const { FESTIVOS, fechaLocal, fechaValida, jornadaDe, lineasHorario, minutosLocales, sumarDias } = require('../citas/horario');
const { leerCalendario, olvidarCalendario } = require('../citas/calendario');
const { exigirRol } = require('../seguridad/sesion');
const { registrar } = require('../seguridad/bitacora');
const { registrarError } = require('../plataforma/registros');
const negocio = require('../bot/negocio');

const DIAS = [0, 1, 2, 3, 4, 5, 6, FESTIVOS];
const RECURSOS = ['CONSULTORIO', 'PELUQUERIA'];
const DIAS_MAX_CIERRE = 365;
const CONFLICTOS_A_MOSTRAR = 10;

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const fechaUtc = (f) => new Date(`${f}T00:00:00Z`);
const esMinuto = (m) => Number.isInteger(m) && m >= 0 && m <= 1440 && m % 30 === 0;

class ErrorAjuste extends Error {
  constructor(mensaje, estado = 400, conflictos) {
    super(mensaje);
    this.estado = estado;
    this.conflictos = conflictos;
  }
}

function validarJornadas(jornadas) {
  if (!Array.isArray(jornadas) || jornadas.length !== DIAS.length) return 'Envía la jornada de los 7 días y de los festivos.';
  const dias = new Set(jornadas.map((j) => j?.dia));
  if (!DIAS.every((d) => dias.has(d))) return 'Falta la jornada de algún día.';
  for (const j of jornadas) {
    if (typeof j.abierto !== 'boolean' || !esMinuto(j.abre) || !esMinuto(j.cierra)) return 'Las horas deben ir en bloques de 30 minutos.';
    if (j.abre >= j.cierra) return 'La hora de cierre debe ser después de la de apertura.';
  }
  return null;
}

function validarServicio(s) {
  if (texto(s.nombre).length < 2 || texto(s.nombre).length > 60) return 'Escribe el nombre del servicio.';
  if (texto(s.detalle).length < 3 || texto(s.detalle).length > 120) return 'Describe el servicio en pocas palabras.';
  if (!Number.isInteger(s.precioDesde) || s.precioDesde < 0 || s.precioDesde > 10000000) return 'El precio no es válido.';
  if (!Number.isInteger(s.duracionMin) || s.duracionMin < 15 || s.duracionMin > 240 || s.duracionMin % 15) return 'La duración va de 15 a 240 minutos, en bloques de 15.';
  if (!RECURSOS.includes(s.recurso)) return 'Elige dónde se atiende.';
  if (typeof s.reservable !== 'boolean' || typeof s.activo !== 'boolean') return 'Datos no válidos';
  return null;
}

const datosServicio = (s) => ({
  nombre: texto(s.nombre), detalle: texto(s.detalle), precioDesde: s.precioDesde, duracionMin: s.duracionMin,
  recurso: s.recurso, reservable: s.reservable, activo: s.activo,
});

// Citas por venir que quedarían por fuera con un calendario nuevo. Un cambio de
// horario no puede dejar a un cliente con una cita en una hora en que no hay nadie.
async function citasPorFuera(prisma, calendario, ahora = new Date()) {
  const citas = await prisma.cita.findMany({
    where: { estado: { in: ['PENDIENTE', 'CONFIRMADA'] }, inicio: { gte: ahora } },
    orderBy: { inicio: 'asc' },
    select: { id: true, inicio: true, fin: true, mascota: { select: { nombre: true } }, servicio: { select: { nombre: true } } },
  });
  return citas.filter((c) => {
    const jornada = jornadaDe(fechaLocal(c.inicio), calendario);
    if (!jornada) return true;
    const inicio = minutosLocales(c.inicio);
    return inicio < jornada.abre || inicio + (c.fin - c.inicio) / 60000 > jornada.cierra;
  });
}

function exigirSinConflictos(conflictos, mensaje) {
  if (!conflictos.length) return;
  const lista = conflictos.slice(0, CONFLICTOS_A_MOSTRAR).map((c) => ({ id: c.id, inicio: c.inicio, mascota: c.mascota.nombre, servicio: c.servicio.nombre }));
  throw new ErrorAjuste(`${mensaje} Hay ${conflictos.length} ${conflictos.length === 1 ? 'cita reservada' : 'citas reservadas'} que quedarían por fuera: cámbialas o cancélalas primero.`, 409, lista);
}

function manejar(accion) {
  return async (req, res) => {
    try {
      await accion(req, res);
    } catch (err) {
      if (err instanceof ErrorAjuste) return res.status(err.estado).json({ error: err.message, conflictos: err.conflictos });
      if (err.code === 'P2002') return res.status(409).json({ error: req.path.startsWith('/cierres') ? 'Ese día ya está cerrado.' : 'Ya existe un servicio con ese nombre.' });
      if (err.code === 'P2025') return res.status(404).json({ error: 'No existe' });
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudo guardar el cambio' });
    }
  };
}

async function vistaHorario(prisma) {
  const calendario = await leerCalendario(prisma);
  const hoy = fechaLocal(new Date());
  return {
    lineas: [...lineasHorario(calendario), negocio.urgencias],
    jornadas: DIAS.map((dia) => ({ dia, ...calendario.jornadas.get(dia) })),
    cierres: [...calendario.cierres].filter(([fecha]) => fecha >= hoy).map(([fecha, motivo]) => ({ fecha, motivo })),
  };
}

function crearRutasAjustes(prisma, verificarSesion) {
  const rutas = express.Router();
  const soloAdmin = [verificarSesion, exigirRol('ADMIN')];

  rutas.get('/horario', manejar(async (req, res) => {
    res.json(await vistaHorario(prisma));
  }));

  rutas.put('/horario', soloAdmin, manejar(async (req, res) => {
    const { jornadas } = req.body || {};
    const error = validarJornadas(jornadas);
    if (error) throw new ErrorAjuste(error);
    const actual = await leerCalendario(prisma);
    const nuevo = { jornadas: new Map(jornadas.map((j) => [j.dia, { abierto: j.abierto, abre: j.abre, cierra: j.cierra }])), cierres: actual.cierres };
    exigirSinConflictos(await citasPorFuera(prisma, nuevo), 'No se puede cambiar el horario.');
    await prisma.$transaction(jornadas.map(({ dia, abierto, abre, cierra }) => prisma.jornada.upsert({
      where: { dia }, update: { abierto, abre, cierra }, create: { dia, abierto, abre, cierra },
    })));
    olvidarCalendario();
    await registrar(prisma, req, 'HORARIO_EDITADO');
    res.json(await vistaHorario(prisma));
  }));

  rutas.post('/cierres', soloAdmin, manejar(async (req, res) => {
    const fecha = req.body?.fecha;
    const motivo = texto(req.body?.motivo);
    const hoy = fechaLocal(new Date());
    if (!fechaValida(fecha) || fecha < hoy || fecha > sumarDias(hoy, DIAS_MAX_CIERRE)) throw new ErrorAjuste('Elige una fecha de hoy en adelante, dentro del próximo año.');
    if (motivo.length < 3 || motivo.length > 80) throw new ErrorAjuste('Escribe el motivo (se muestra a los clientes).');
    const actual = await leerCalendario(prisma);
    const nuevo = { jornadas: actual.jornadas, cierres: new Map([...actual.cierres, [fecha, motivo]]) };
    const delDia = (await citasPorFuera(prisma, nuevo)).filter((c) => fechaLocal(c.inicio) === fecha);
    exigirSinConflictos(delDia, 'No se puede cerrar ese día.');
    await prisma.cierre.create({ data: { fecha: fechaUtc(fecha), motivo } });
    olvidarCalendario();
    await registrar(prisma, req, 'CIERRE_CREADO', { detalle: `${fecha}: ${motivo}` });
    res.status(201).json(await vistaHorario(prisma));
  }));

  rutas.delete('/cierres/:fecha', soloAdmin, manejar(async (req, res) => {
    const { fecha } = req.params;
    if (!fechaValida(fecha)) throw new ErrorAjuste('Fecha no válida');
    await prisma.cierre.delete({ where: { fecha: fechaUtc(fecha) } });
    olvidarCalendario();
    await registrar(prisma, req, 'CIERRE_BORRADO', { detalle: fecha });
    res.json(await vistaHorario(prisma));
  }));

  // Incluye los servicios inactivos, que la lista pública no muestra.
  rutas.get('/servicios/todos', soloAdmin, manejar(async (req, res) => {
    res.json(await prisma.servicio.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { citas: true } } } }));
  }));

  rutas.post('/servicios', soloAdmin, manejar(async (req, res) => {
    const error = validarServicio(req.body || {});
    if (error) throw new ErrorAjuste(error);
    const servicio = await prisma.servicio.create({ data: datosServicio(req.body) });
    await registrar(prisma, req, 'SERVICIO_CREADO', { entidad: 'Servicio', entidadId: servicio.id, detalle: servicio.nombre });
    res.status(201).json(servicio);
  }));

  // Cambiar la duración no mueve las citas ya reservadas: cada una guarda su hora de fin.
  rutas.patch('/servicios/:id', soloAdmin, manejar(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ErrorAjuste('Datos no válidos');
    const error = validarServicio(req.body || {});
    if (error) throw new ErrorAjuste(error);
    const servicio = await prisma.servicio.update({ where: { id }, data: datosServicio(req.body) });
    await registrar(prisma, req, 'SERVICIO_EDITADO', { entidad: 'Servicio', entidadId: id, detalle: servicio.nombre });
    res.json(servicio);
  }));

  return rutas;
}

module.exports = { crearRutasAjustes, citasPorFuera };
