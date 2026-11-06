// Sesión del panel en una cookie httpOnly: el JavaScript de la página no puede
// leerla, así un script inyectado no se la puede robar. Cada petición consulta
// al usuario, por eso desactivarlo o cambiar su rol aplica de inmediato.
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { registrar } = require('./bitacora');

const COOKIE = 'huellitas_sesion';
const DURACION_MS = 8 * 60 * 60 * 1000;
const MIN_CLAVE = 12;
// Hash que no corresponde a ninguna clave: compararlo tarda lo mismo que uno real,
// así el tiempo de respuesta no revela si el correo existe.
const HASH_SEÑUELO = bcrypt.hashSync('sin-cuenta-asociada', 10);

const ROLES = ['ADMIN', 'VETERINARIO', 'RECEPCION'];

const opcionesCookie = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Strict: el navegador no la envía desde otros sitios, lo que frena el CSRF.
  sameSite: 'strict',
  path: '/api',
});

const mensajeLimite = { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' };
const saltarEnPruebas = () => process.env.NODE_ENV === 'test' && !process.env.PROBAR_LIMITES;

// Dos límites. Por IP frena a quien prueba muchas cuentas; es más alto porque una
// oficina comparte IP. Por cuenta frena a quien ataca una sola, aunque cambie de IP.
const limitePorIp = rateLimit({ skip: saltarEnPruebas, windowMs: 15 * 60 * 1000, limit: 30, skipSuccessfulRequests: true, message: mensajeLimite });
const limitePorCuenta = rateLimit({
  skip: saltarEnPruebas,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `cuenta:${String(req.body?.email).trim().toLowerCase().slice(0, 120)}`,
  message: mensajeLimite,
});

const publico = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });

function crearVerificarSesion(prisma) {
  return async function verificarSesion(req, res, next) {
    const noAutorizado = () => res.status(401).json({ error: 'Inicia sesión para continuar' });
    let datos;
    try {
      datos = jwt.verify(req.cookies?.[COOKIE] || '', process.env.JWT_SECRET);
    } catch {
      return noAutorizado();
    }
    try {
      const usuario = await prisma.usuario.findUnique({ where: { id: datos.id } });
      if (!usuario || !usuario.activo || usuario.sesionVersion !== datos.v) return noAutorizado();
      req.usuario = publico(usuario);
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo verificar la sesión' });
    }
  };
}

// Permite pasar solo a los roles indicados.
const exigirRol = (...roles) => (req, res, next) => {
  if (roles.includes(req.usuario?.rol)) return next();
  return res.status(403).json({ error: 'Tu rol no tiene permiso para esto' });
};

// La demo es pública: nadie debe poder cambiar sus cuentas y dejarla sin acceso.
const soloFueraDeDemo = (req, res, next) => {
  if (process.env.MODO_DEMO === 'true') return res.status(403).json({ error: 'Esta acción está desactivada en la demo pública.' });
  return next();
};

function crearRutasSesion(prisma, verificarSesion) {
  const rutas = express.Router();

  rutas.post('/login', limitePorIp, limitePorCuenta, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }
    const correo = email.trim().toLowerCase();
    try {
      const usuario = await prisma.usuario.findUnique({ where: { email: correo } });
      const correcta = await bcrypt.compare(password, usuario?.password || HASH_SEÑUELO);
      if (!usuario || !usuario.activo || !correcta) {
        await registrar(prisma, req, 'LOGIN_FALLIDO', { email: correo });
        return res.status(401).json({ error: 'Email o contraseña incorrectos' });
      }
      const token = jwt.sign({ id: usuario.id, v: usuario.sesionVersion }, process.env.JWT_SECRET, { expiresIn: DURACION_MS / 1000 });
      res.cookie(COOKIE, token, { ...opcionesCookie(), maxAge: DURACION_MS });
      await registrar(prisma, { ...req, ip: req.ip, usuario: publico(usuario) }, 'LOGIN');
      res.json(publico(usuario));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al iniciar sesión' });
    }
  });

  rutas.post('/logout', verificarSesion, async (req, res) => {
    res.clearCookie(COOKIE, opcionesCookie());
    await registrar(prisma, req, 'LOGOUT');
    res.status(204).end();
  });

  rutas.get('/sesion', verificarSesion, (req, res) => res.json(req.usuario));

  // Cambiar la clave cierra las demás sesiones de esa cuenta.
  rutas.post('/sesion/clave', verificarSesion, soloFueraDeDemo, async (req, res) => {
    const { actual, nueva } = req.body || {};
    if (typeof actual !== 'string' || typeof nueva !== 'string') return res.status(400).json({ error: 'Datos no válidos' });
    if (nueva.length < MIN_CLAVE) return res.status(400).json({ error: `La nueva contraseña debe tener al menos ${MIN_CLAVE} caracteres.` });
    try {
      const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
      if (!(await bcrypt.compare(actual, usuario.password))) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
      const actualizado = await prisma.usuario.update({
        where: { id: usuario.id },
        data: { password: await bcrypt.hash(nueva, 12), sesionVersion: { increment: 1 } },
      });
      const token = jwt.sign({ id: usuario.id, v: actualizado.sesionVersion }, process.env.JWT_SECRET, { expiresIn: DURACION_MS / 1000 });
      res.cookie(COOKIE, token, { ...opcionesCookie(), maxAge: DURACION_MS });
      await registrar(prisma, req, 'CLAVE_CAMBIADA');
      res.status(204).end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
    }
  });

  return rutas;
}

module.exports = { COOKIE, MIN_CLAVE, ROLES, crearVerificarSesion, crearRutasSesion, exigirRol, soloFueraDeDemo };
