// Rutas del enlace del cliente, del registro de correos y de los recordatorios.
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ErrorAgenda, esCruce } = require('../citas/agenda');
const { finDe, horariosPosibles, fechaLocal } = require('../citas/horario');
const { avisar, enviarRecordatorios, ultimasNotificaciones } = require('./avisos');
const { leerToken } = require('./enlace');
const { exigirRol } = require('../seguridad/sesion');
const { registrarError } = require('../plataforma/registros');

const ANTELACION_MIN = 120; // el cliente puede cambiar su cita hasta 2 horas antes
const ACTIVAS = ['PENDIENTE', 'CONFIRMADA'];

const limiteCliente = rateLimit({ skip: () => process.env.NODE_ENV === 'test', windowMs: 15 * 60 * 1000, limit: 40, message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' } });

const sePuedeGestionar = (cita, ahora) => ACTIVAS.includes(cita.estado) && cita.inicio.getTime() - ahora.getTime() >= ANTELACION_MIN * 60 * 1000;

// Solo lo que necesita quien abre el enlace: ni correo ni teléfono.
const vistaCliente = (cita, ahora) => ({
  servicioId: cita.servicioId,
  servicio: cita.servicio.nombre,
  mascota: cita.mascota.nombre,
  especie: cita.mascota.especie,
  inicio: cita.inicio,
  fin: cita.fin,
  estado: cita.estado,
  sePuedeGestionar: sePuedeGestionar(cita, ahora),
});

async function citaDelToken(prisma, token) {
  const id = leerToken(token);
  const cita = id && await prisma.cita.findUnique({ where: { id }, include: { servicio: true, mascota: { select: { nombre: true, especie: true } } } });
  // El mismo mensaje para un código falso y una cita que no existe.
  if (!cita) throw new ErrorAgenda('Este enlace no es válido.', 404);
  return cita;
}

function exigirGestionable(cita, ahora) {
  if (!sePuedeGestionar(cita, ahora)) throw new ErrorAgenda('Esta cita ya no se puede cambiar en línea. Llámanos, por favor.');
}

function manejar(accion) {
  return async (req, res) => {
    try {
      await accion(req, res);
    } catch (err) {
      if (err instanceof ErrorAgenda) return res.status(err.estado).json({ error: err.message });
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudo completar la operación' });
    }
  };
}

function tokenDeTareaValido(req) {
  const esperado = Buffer.from(process.env.TAREAS_TOKEN);
  const dado = Buffer.from(String(req.headers['x-tarea-token'] || ''));
  return esperado.length === dado.length && crypto.timingSafeEqual(esperado, dado);
}

function crearRutasAvisos(prisma, verificarToken) {
  const rutas = express.Router();

  rutas.get('/mi-cita/:token', limiteCliente, manejar(async (req, res) => {
    res.json(vistaCliente(await citaDelToken(prisma, req.params.token), new Date()));
  }));

  rutas.post('/mi-cita/:token/cancelar', limiteCliente, manejar(async (req, res) => {
    const ahora = new Date();
    const cita = await citaDelToken(prisma, req.params.token);
    exigirGestionable(cita, ahora);
    const { count } = await prisma.cita.updateMany({ where: { id: cita.id, estado: { in: ACTIVAS } }, data: { estado: 'CANCELADA' } });
    if (!count) throw new ErrorAgenda('Esta cita acaba de cambiar. Actualiza la página.');
    await avisar(prisma, 'CANCELADA', cita.id);
    res.json(vistaCliente(await citaDelToken(prisma, req.params.token), ahora));
  }));

  rutas.post('/mi-cita/:token/cambiar', limiteCliente, manejar(async (req, res) => {
    const ahora = new Date();
    const cita = await citaDelToken(prisma, req.params.token);
    exigirGestionable(cita, ahora);
    const inicio = new Date(req.body?.inicio);
    if (Number.isNaN(inicio.getTime())) throw new ErrorAgenda('Elige un horario.', 400);
    if (inicio.getTime() === cita.inicio.getTime()) throw new ErrorAgenda('Esa ya es la hora de tu cita.', 400);
    const permitido = horariosPosibles(fechaLocal(inicio), cita.servicio.duracionMin, ahora).some((h) => h.getTime() === inicio.getTime());
    if (!permitido) throw new ErrorAgenda('Ese horario no está disponible. Elige otro, por favor.', 400);

    try {
      // Vuelve a pendiente: el equipo debe confirmar la nueva hora.
      const { count } = await prisma.cita.updateMany({
        where: { id: cita.id, inicio: cita.inicio, estado: { in: ACTIVAS } },
        data: { inicio, fin: finDe(inicio, cita.servicio.duracionMin), estado: 'PENDIENTE', recordatorioEn: null },
      });
      if (!count) throw new ErrorAgenda('Esta cita acaba de cambiar. Actualiza la página.');
    } catch (err) {
      if (esCruce(err)) throw new ErrorAgenda('Alguien acaba de reservar ese horario. Elige otro, por favor.');
      throw err;
    }
    await avisar(prisma, 'REPROGRAMADA', cita.id);
    res.json(vistaCliente(await citaDelToken(prisma, req.params.token), ahora));
  }));

  rutas.get('/notificaciones', verificarToken, exigirRol('ADMIN', 'RECEPCION'), manejar(async (req, res) => {
    res.json({ envioReal: Boolean(process.env.BREVO_API_KEY), notificaciones: await ultimasNotificaciones(prisma) });
  }));

  // Botón del panel para enviar a mano los recordatorios de mañana.
  rutas.post('/recordatorios', verificarToken, exigirRol('ADMIN', 'RECEPCION'), manejar(async (req, res) => {
    res.json(await enviarRecordatorios(prisma));
  }));

  // La tarea diaria de GitHub Actions. Sin TAREAS_TOKEN, esta ruta no existe.
  rutas.post('/tareas/recordatorios', manejar(async (req, res) => {
    if (!process.env.TAREAS_TOKEN) return res.status(404).json({ error: 'No existe' });
    if (!tokenDeTareaValido(req)) return res.status(401).json({ error: 'No autorizado' });
    res.json(await enviarRecordatorios(prisma));
  }));

  return rutas;
}

module.exports = { crearRutasAvisos };
