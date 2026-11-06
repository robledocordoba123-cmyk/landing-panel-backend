// Cuentas del equipo y lectura de la bitácora. Solo para administración.
const express = require('express');
const bcrypt = require('bcrypt');
const { leerBitacora, registrar } = require('./bitacora');
const { MIN_CLAVE, ROLES, exigirRol, soloFueraDeDemo } = require('./sesion');

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const vista = { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true };

function validar({ nombre, email, rol, password }, { nueva }) {
  if (texto(nombre).length < 2 || texto(nombre).length > 80) return 'Escribe el nombre.';
  if (nueva && !CORREO.test(texto(email))) return 'Escribe un correo válido.';
  if (!ROLES.includes(rol)) return 'Elige un rol.';
  if (nueva && (typeof password !== 'string' || password.length < MIN_CLAVE)) return `La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`;
  return null;
}

function crearRutasEquipo(prisma, verificarSesion) {
  const rutas = express.Router();
  const soloAdmin = [verificarSesion, exigirRol('ADMIN')];

  rutas.get('/usuarios', soloAdmin, async (req, res) => {
    res.json(await prisma.usuario.findMany({ orderBy: { nombre: 'asc' }, select: vista }));
  });

  rutas.post('/usuarios', soloAdmin, soloFueraDeDemo, async (req, res) => {
    const error = validar(req.body || {}, { nueva: true });
    if (error) return res.status(400).json({ error });
    const { nombre, email, rol, password } = req.body;
    try {
      const usuario = await prisma.usuario.create({
        data: { nombre: texto(nombre), email: texto(email).toLowerCase(), rol, password: await bcrypt.hash(password, 12) },
        select: vista,
      });
      await registrar(prisma, req, 'USUARIO_CREADO', { entidad: 'Usuario', entidadId: usuario.id, detalle: rol });
      res.status(201).json(usuario);
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
      console.error(err);
      res.status(500).json({ error: 'No se pudo crear la cuenta' });
    }
  });

  rutas.patch('/usuarios/:id', soloAdmin, soloFueraDeDemo, async (req, res) => {
    const id = Number(req.params.id);
    const { nombre, rol, activo } = req.body || {};
    if (!Number.isInteger(id) || typeof activo !== 'boolean') return res.status(400).json({ error: 'Datos no válidos' });
    const error = validar({ nombre, rol }, { nueva: false });
    if (error) return res.status(400).json({ error });
    try {
      const usuario = await prisma.$transaction(async (tx) => {
        const antes = await tx.usuario.findUnique({ where: { id } });
        if (!antes) return null;
        const actualizado = await tx.usuario.update({
          where: { id },
          // Cambiar rol o desactivar cierra sus sesiones abiertas.
          data: { nombre: texto(nombre), rol, activo, sesionVersion: { increment: antes.rol !== rol || !activo ? 1 : 0 } },
          select: vista,
        });
        // Dentro de la transacción: nunca queda el negocio sin administración.
        const admins = await tx.usuario.count({ where: { rol: 'ADMIN', activo: true } });
        if (!admins) throw new Error('SIN_ADMIN');
        return actualizado;
      });
      if (!usuario) return res.status(404).json({ error: 'La cuenta no existe' });
      await registrar(prisma, req, 'USUARIO_EDITADO', { entidad: 'Usuario', entidadId: id, detalle: `${rol}, ${activo ? 'activa' : 'inactiva'}` });
      res.json(usuario);
    } catch (err) {
      if (err.message === 'SIN_ADMIN') return res.status(409).json({ error: 'Debe quedar al menos una cuenta de administración activa.' });
      console.error(err);
      res.status(500).json({ error: 'No se pudo actualizar la cuenta' });
    }
  });

  rutas.get('/bitacora', soloAdmin, async (req, res) => {
    const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    res.json(await leerBitacora(prisma, pagina));
  });

  return rutas;
}

module.exports = { crearRutasEquipo };
