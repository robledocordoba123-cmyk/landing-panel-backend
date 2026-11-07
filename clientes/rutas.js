// Rutas de clientes y mascotas. Todas protegidas: es información personal y de
// salud, solo para el equipo del negocio.
const express = require('express');
const { ErrorAgenda } = require('../citas/agenda');
const { fechaLocal, fechaValida } = require('../citas/horario');
const { ESPECIES } = require('./mascotas');
const { buscarClientes, detalleCliente, fichaMascota, registrarAtencion, registrarVacuna, suprimirCliente, vacunasPorVencer } = require('./ficha');
const { exigirRol, soloFueraDeDemo } = require('../seguridad/sesion');
const { registrar } = require('../seguridad/bitacora');
const { leerPagina } = require('../plataforma/paginacion');
const { registrarError } = require('../plataforma/registros');

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEXOS = ['Macho', 'Hembra'];
const DIAS_AVISO = 30;
const CLINICA = ['ADMIN', 'VETERINARIO'];

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const opcional = (v) => texto(v) || null;
const fechaUtc = (f) => new Date(`${f}T00:00:00Z`);

function validarCliente(c) {
  if (texto(c.nombre).length < 2 || texto(c.nombre).length > 80) return 'Escribe el nombre (entre 2 y 80 letras).';
  if (!CORREO.test(texto(c.email)) || texto(c.email).length > 120) return 'Escribe un correo válido.';
  if (c.telefono && !/^[\d\s+()-]{7,20}$/.test(texto(c.telefono))) return 'El teléfono no es válido.';
  return null;
}

function validarMascota(m, hoy) {
  if (texto(m.nombre).length < 1 || texto(m.nombre).length > 60) return 'Escribe el nombre de la mascota.';
  if (!ESPECIES.includes(m.especie)) return 'Elige la especie.';
  if (m.sexo && !SEXOS.includes(m.sexo)) return 'Elige el sexo.';
  if (texto(m.raza).length > 60) return 'La raza es muy larga.';
  if (texto(m.notas).length > 1000) return 'Las notas son muy largas.';
  if (m.fechaNacimiento && (!fechaValida(m.fechaNacimiento) || m.fechaNacimiento > hoy)) return 'La fecha de nacimiento no es válida.';
  return null;
}

const datosMascota = (m) => ({
  nombre: texto(m.nombre),
  especie: m.especie,
  raza: opcional(m.raza),
  sexo: m.sexo || null,
  notas: opcional(m.notas),
  fechaNacimiento: m.fechaNacimiento ? fechaUtc(m.fechaNacimiento) : null,
});

function numeroEnRango(v, min, max) {
  return v === undefined || v === null || v === '' || (typeof v === 'number' && v >= min && v <= max);
}

function validarAtencion(a) {
  if (texto(a.motivo).length < 3 || texto(a.motivo).length > 300) return 'Escribe el motivo de la atención.';
  if (texto(a.diagnostico).length > 2000 || texto(a.tratamiento).length > 2000) return 'El texto es muy largo.';
  if (!numeroEnRango(a.pesoKg, 0.01, 200)) return 'El peso no es válido.';
  if (!numeroEnRango(a.temperaturaC, 30, 45)) return 'La temperatura no es válida.';
  if (a.citaId !== undefined && a.citaId !== null && !Number.isInteger(a.citaId)) return 'La cita no es válida.';
  return null;
}

function validarVacuna(v, hoy) {
  if (texto(v.nombre).length < 2 || texto(v.nombre).length > 80) return 'Escribe el nombre de la vacuna.';
  if (!fechaValida(v.aplicadaEn) || v.aplicadaEn > hoy) return 'La fecha de aplicación no es válida.';
  if (v.proximaDosis && (!fechaValida(v.proximaDosis) || v.proximaDosis <= v.aplicadaEn)) return 'La próxima dosis debe ser después de la aplicación.';
  if (texto(v.lote).length > 40) return 'El lote es muy largo.';
  return null;
}

// Convierte el id de la URL y responde con los errores de forma uniforme.
function manejar(accion) {
  return async (req, res) => {
    const id = req.params.id === undefined ? null : Number(req.params.id);
    if (id !== null && !Number.isInteger(id)) return res.status(400).json({ error: 'Datos no válidos' });
    try {
      await accion(req, res, id);
    } catch (err) {
      if (err instanceof ErrorAgenda) return res.status(err.estado).json({ error: err.message });
      if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un cliente con ese correo.' });
      if (err.code === 'P2025') return res.status(404).json({ error: 'No existe' });
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudo completar la operación' });
    }
  };
}

function crearRutasClientes(prisma, verificarToken) {
  const rutas = express.Router();
  rutas.use(['/clientes', '/mascotas', '/vacunas'], verificarToken);

  rutas.get('/clientes', manejar(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
    res.json(await buscarClientes(prisma, q, leerPagina(req.query.pagina)));
  }));

  rutas.get('/clientes/:id', manejar(async (req, res, id) => {
    res.json(await detalleCliente(prisma, id));
  }));

  rutas.patch('/clientes/:id', exigirRol('ADMIN', 'RECEPCION'), manejar(async (req, res, id) => {
    const error = validarCliente(req.body || {});
    if (error) return res.status(400).json({ error });
    const { nombre, email, telefono } = req.body;
    const cliente = await prisma.cliente.update({ where: { id }, data: { nombre: texto(nombre), email: texto(email).toLowerCase(), telefono: opcional(telefono) } });
    await registrar(prisma, req, 'CLIENTE_EDITADO', { entidad: 'Cliente', entidadId: id });
    res.json(cliente);
  }));

  rutas.post('/clientes/:id/suprimir', exigirRol('ADMIN'), soloFueraDeDemo, manejar(async (req, res, id) => {
    await suprimirCliente(prisma, id);
    await registrar(prisma, req, 'DATOS_SUPRIMIDOS', { entidad: 'Cliente', entidadId: id });
    res.json({ ok: true });
  }));

  rutas.post('/clientes/:id/mascotas', manejar(async (req, res, id) => {
    const error = validarMascota(req.body || {}, fechaLocal(new Date()));
    if (error) return res.status(400).json({ error });
    await detalleCliente(prisma, id);
    res.status(201).json(await prisma.mascota.create({ data: { ...datosMascota(req.body), clienteId: id } }));
  }));

  rutas.get('/mascotas/:id', manejar(async (req, res, id) => {
    const conHistoria = CLINICA.includes(req.usuario.rol);
    const ficha = await fichaMascota(prisma, id, { conHistoria });
    if (conHistoria) await registrar(prisma, req, 'HISTORIA_VISTA', { entidad: 'Mascota', entidadId: id });
    res.json(ficha);
  }));

  rutas.patch('/mascotas/:id', manejar(async (req, res, id) => {
    const error = validarMascota(req.body || {}, fechaLocal(new Date()));
    if (error) return res.status(400).json({ error });
    res.json(await prisma.mascota.update({ where: { id }, data: datosMascota(req.body) }));
  }));

  rutas.post('/mascotas/:id/atenciones', exigirRol(...CLINICA), manejar(async (req, res, id) => {
    const a = req.body || {};
    const error = validarAtencion(a);
    if (error) return res.status(400).json({ error });
    const datos = {
      citaId: a.citaId,
      motivo: texto(a.motivo),
      diagnostico: opcional(a.diagnostico),
      tratamiento: opcional(a.tratamiento),
      pesoKg: a.pesoKg || null,
      temperaturaC: a.temperaturaC || null,
    };
    const atencion = await registrarAtencion(prisma, id, datos, req.usuario.email);
    await registrar(prisma, req, 'HISTORIA_ESCRITA', { entidad: 'Mascota', entidadId: id });
    res.status(201).json(atencion);
  }));

  rutas.post('/mascotas/:id/vacunas', exigirRol(...CLINICA), manejar(async (req, res, id) => {
    const v = req.body || {};
    const error = validarVacuna(v, fechaLocal(new Date()));
    if (error) return res.status(400).json({ error });
    const datos = { nombre: texto(v.nombre), aplicadaEn: fechaUtc(v.aplicadaEn), proximaDosis: v.proximaDosis ? fechaUtc(v.proximaDosis) : null, lote: opcional(v.lote) };
    const vacuna = await registrarVacuna(prisma, id, datos, req.usuario.email);
    await registrar(prisma, req, 'VACUNA_REGISTRADA', { entidad: 'Mascota', entidadId: id });
    res.status(201).json(vacuna);
  }));

  rutas.get('/vacunas/por-vencer', manejar(async (req, res) => {
    res.json(await vacunasPorVencer(prisma, DIAS_AVISO));
  }));

  // Para corregir una vacuna mal registrada.
  rutas.delete('/vacunas/:id', exigirRol(...CLINICA), manejar(async (req, res, id) => {
    await prisma.vacuna.delete({ where: { id } });
    await registrar(prisma, req, 'VACUNA_BORRADA', { entidad: 'Vacuna', entidadId: id });
    res.status(204).end();
  }));

  return rutas;
}

module.exports = { crearRutasClientes };
