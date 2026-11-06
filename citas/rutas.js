// Rutas de la agenda: públicas para reservar, protegidas para el panel.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ErrorAgenda, cambiarEstado, citasEntre, crearCita, disponibilidad } = require('./agenda');
const { fechaLocal, fechaValida, horaLegible, jornadaDe, sumarDias } = require('./horario');
const { ESPECIES } = require('../clientes/mascotas');

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIAS_MAX_CONSULTA = 31;

const limiteReservas = rateLimit({ skip: () => process.env.NODE_ENV === 'test', windowMs: 15 * 60 * 1000, limit: 10, message: { error: 'Hiciste muchas reservas. Intenta de nuevo en unos minutos.' } });

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

function validarReserva(cuerpo) {
  if (texto(cuerpo.nombre).length < 2 || texto(cuerpo.nombre).length > 80) return 'Escribe tu nombre (entre 2 y 80 letras).';
  if (!CORREO.test(texto(cuerpo.email)) || texto(cuerpo.email).length > 120) return 'Escribe un correo válido.';
  if (!/^[\d\s+()-]{7,20}$/.test(texto(cuerpo.telefono))) return 'Escribe un teléfono válido para confirmarte la cita.';
  if (texto(cuerpo.mascota).length < 1 || texto(cuerpo.mascota).length > 60) return 'Escribe el nombre de tu mascota.';
  if (!ESPECIES.includes(cuerpo.especie)) return 'Elige qué animal es tu mascota.';
  if (texto(cuerpo.notas).length > 500) return 'La nota es muy larga (máximo 500 letras).';
  if (!Number.isInteger(cuerpo.servicioId)) return 'Elige un servicio.';
  if (typeof cuerpo.inicio !== 'string' || Number.isNaN(new Date(cuerpo.inicio).getTime())) return 'Elige un horario.';
  return null;
}

const citaPublica = (c) => ({ id: c.id, servicio: c.servicio.nombre, inicio: c.inicio, fin: c.fin, estado: c.estado });

function responderError(res, err, mensaje) {
  if (err instanceof ErrorAgenda) return res.status(err.estado).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: mensaje });
}

function crearRutasCitas(prisma, verificarToken) {
  const rutas = express.Router();

  rutas.get('/servicios', async (req, res) => {
    try {
      res.json(await prisma.servicio.findMany({ orderBy: { id: 'asc' } }));
    } catch (err) {
      responderError(res, err, 'No se pudieron obtener los servicios');
    }
  });

  // Solo devuelve horarios libres: nunca quién reservó los demás.
  rutas.get('/disponibilidad', async (req, res) => {
    const servicioId = Number(req.query.servicioId);
    const { fecha } = req.query;
    if (!Number.isInteger(servicioId) || !fechaValida(fecha)) return res.status(400).json({ error: 'Datos no válidos' });
    try {
      const servicio = await prisma.servicio.findUnique({ where: { id: servicioId } });
      if (!servicio || !servicio.reservable) return res.status(404).json({ error: 'Ese servicio no se reserva en línea' });
      const horarios = await disponibilidad(prisma, servicio, fecha);
      res.json({ fecha, jornada: jornadaDe(fecha), horarios: horarios.map((h) => ({ inicio: h, hora: horaLegible(h) })) });
    } catch (err) {
      responderError(res, err, 'No se pudo consultar la disponibilidad');
    }
  });

  rutas.post('/citas', limiteReservas, async (req, res) => {
    const cuerpo = req.body || {};
    const error = validarReserva(cuerpo);
    if (error) return res.status(400).json({ error });
    try {
      const servicio = await prisma.servicio.findUnique({ where: { id: cuerpo.servicioId } });
      if (!servicio) return res.status(400).json({ error: 'Elige un servicio de la lista.' });
      const cita = await crearCita(prisma, {
        servicio,
        inicio: new Date(cuerpo.inicio),
        nombre: texto(cuerpo.nombre),
        email: texto(cuerpo.email).toLowerCase(),
        telefono: texto(cuerpo.telefono),
        mascota: texto(cuerpo.mascota),
        especie: cuerpo.especie,
        notas: texto(cuerpo.notas) || null,
      });
      res.status(201).json(citaPublica(cita));
    } catch (err) {
      responderError(res, err, 'No se pudo guardar la cita');
    }
  });

  // Agenda del panel. ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por defecto, hoy).
  rutas.get('/citas', verificarToken, async (req, res) => {
    const desde = req.query.desde || fechaLocal(new Date());
    const hasta = req.query.hasta || desde;
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde || hasta > sumarDias(desde, DIAS_MAX_CONSULTA)) {
      return res.status(400).json({ error: 'Rango de fechas no válido' });
    }
    try {
      res.json({ desde, hasta, citas: await citasEntre(prisma, desde, hasta) });
    } catch (err) {
      responderError(res, err, 'No se pudo obtener la agenda');
    }
  });

  rutas.patch('/citas/:id/estado', verificarToken, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Datos no válidos' });
    try {
      res.json(await cambiarEstado(prisma, id, req.body?.estado));
    } catch (err) {
      responderError(res, err, 'No se pudo actualizar la cita');
    }
  });

  return rutas;
}

module.exports = { crearRutasCitas };
