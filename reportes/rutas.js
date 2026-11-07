const express = require('express');
const { fechaLocal, fechaValida } = require('../citas/horario');
const { exigirRol } = require('../seguridad/sesion');
const { registrarError } = require('../plataforma/registros');
const { DIAS_MAX, diasEntre, reporte } = require('./reportes');

function crearRutasReportes(prisma, verificarSesion) {
  const rutas = express.Router();

  // ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD. Por defecto, el mes en curso hasta hoy.
  rutas.get('/reportes', verificarSesion, exigirRol('ADMIN'), async (req, res) => {
    const hoy = fechaLocal(new Date());
    const desde = req.query.desde || `${hoy.slice(0, 7)}-01`;
    const hasta = req.query.hasta || hoy;
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde || diasEntre(desde, hasta) > DIAS_MAX) {
      return res.status(400).json({ error: `Elige un periodo válido de máximo ${DIAS_MAX} días.` });
    }
    try {
      res.json(await reporte(prisma, desde, hasta));
    } catch (err) {
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudo calcular el reporte' });
    }
  });

  return rutas;
}

module.exports = { crearRutasReportes };
