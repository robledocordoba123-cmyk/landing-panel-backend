// Simulador del asistente para la página: usa el mismo motor que WhatsApp. Cada
// pestaña tiene su propia conversación (un id aleatorio que genera la página).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { procesarMensaje } = require('./motor');
const { registrarError } = require('../plataforma/registros');

const limiteSimulador = rateLimit({ skip: () => process.env.NODE_ENV === 'test', windowMs: 10 * 60 * 1000, limit: 60, message: { error: 'Demasiados mensajes. Espera unos minutos.' } });

function crearRutasSimulador(prisma) {
  const rutas = express.Router();

  rutas.post('/bot/simulador', limiteSimulador, async (req, res) => {
    const { sesion, texto } = req.body || {};
    if (typeof sesion !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(sesion) || typeof texto !== 'string' || !texto.trim() || texto.length > 500) {
      return res.status(400).json({ error: 'Mensaje no válido' });
    }
    try {
      const { respuestas } = await procesarMensaje(prisma, { id: `sim:${sesion}`, texto });
      res.json({ respuestas });
    } catch (err) {
      registrarError(req, err);
      res.status(500).json({ error: 'El asistente no pudo responder' });
    }
  });

  return rutas;
}

module.exports = { crearRutasSimulador };
