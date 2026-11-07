require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { procesarMensaje } = require('./bot/motor');
const { crearRutasWhatsApp } = require('./bot/whatsapp');
const { crearRutasCitas } = require('./citas/rutas');
const { crearRutasClientes } = require('./clientes/rutas');
const { crearRutasAvisos } = require('./avisos/rutas');
const { crearRutasSesion, crearVerificarSesion } = require('./seguridad/sesion');
const { crearRutasEquipo } = require('./seguridad/equipo');
const { manejarErrores, rutaNoEncontrada } = require('./plataforma/errores');
const { registrarError, registrarPeticiones } = require('./plataforma/registros');
const { crearRutaSalud } = require('./plataforma/salud');

const prisma = new PrismaClient();
const app = express();
if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en las variables de entorno.');
  process.exit(1);
}

app.use(registrarPeticiones);

// Solo el frontend configurado puede llamar a la API desde el navegador.
const origenes = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(helmet());
app.use(cors(origenes.length ? { origin: origenes } : {}));
// Se guarda el cuerpo tal como llegó: WhatsApp firma los bytes exactos.
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.cuerpoCrudo = buf; } }));
app.use(cookieParser());
// La API va detrás de varios proxies: los 3 de Render más Vercel (TRUST_PROXY=4).
// Sin el número correcto, el límite de intentos no ve la IP real del visitante.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

const SERVICIOS = ['Consulta general', 'Vacunación', 'Peluquería', 'Urgencias', 'Otro'];
const ESTADOS = ['NUEVO', 'ATENDIDO'];
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// El formulario es público: se limita para que nadie lo use para llenar la base de datos.
const limiteFormulario = rateLimit({ skip: () => process.env.NODE_ENV === 'test', windowMs: 15 * 60 * 1000, limit: 10, message: { error: 'Enviaste muchas solicitudes. Intenta de nuevo en unos minutos.' } });

const verificarSesion = crearVerificarSesion(prisma);

// Revisa los datos del formulario y devuelve el primer error que encuentre.
function validarSolicitud({ nombre, email, telefono, mascota, servicio, mensaje, autorizaDatos }) {
  const texto = (v) => (typeof v === 'string' ? v.trim() : '');
  if (texto(nombre).length < 2 || texto(nombre).length > 80) return 'Escribe tu nombre (entre 2 y 80 letras).';
  if (!CORREO.test(texto(email)) || texto(email).length > 120) return 'Escribe un correo válido.';
  if (telefono && !/^[\d\s+()-]{7,20}$/.test(texto(telefono))) return 'El teléfono no es válido.';
  if (mascota && texto(mascota).length > 60) return 'El nombre de la mascota es muy largo.';
  if (servicio && !SERVICIOS.includes(servicio)) return 'Elige un servicio de la lista.';
  if (texto(mensaje).length < 5 || texto(mensaje).length > 1000) return 'Cuéntanos qué necesitas (entre 5 y 1000 letras).';
  if (autorizaDatos !== true) return 'Debes autorizar el tratamiento de tus datos para enviar el mensaje.';
  return null;
}

app.get('/', (req, res) => {
  res.json({ estado: 'ok', servicio: 'API de Huellitas Veterinaria' });
});
app.get('/api/salud', crearRutaSalud(prisma));

// Guarda una solicitud de cita que llega desde la página (público).
app.post('/api/mensajes', limiteFormulario, async (req, res) => {
  const error = validarSolicitud(req.body || {});
  if (error) return res.status(400).json({ error });

  const { nombre, email, telefono, mascota, servicio, mensaje } = req.body;
  try {
    const nueva = await prisma.mensaje.create({
      data: {
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        telefono: telefono?.trim() || null,
        mascota: mascota?.trim() || null,
        servicio: servicio || null,
        mensaje: mensaje.trim(),
        autorizaDatosEn: new Date(),
      },
      select: { id: true, creadoEn: true },
    });
    res.status(201).json(nueva);
  } catch (err) {
    registrarError(req, err);
    res.status(500).json({ error: 'No se pudo guardar la solicitud' });
  }
});

// Lista las solicitudes para el panel (protegido). ?estado=NUEVO|ATENDIDO
app.get('/api/mensajes', verificarSesion, async (req, res) => {
  const { estado } = req.query;
  if (estado && !ESTADOS.includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  try {
    const [mensajes, porEstado] = await Promise.all([
      prisma.mensaje.findMany({ where: estado ? { estado } : {}, orderBy: { creadoEn: 'desc' }, take: 200 }),
      prisma.mensaje.groupBy({ by: ['estado'], _count: { _all: true } }),
    ]);
    const resumen = Object.fromEntries(ESTADOS.map((e) => [e, porEstado.find((p) => p.estado === e)?._count._all || 0]));
    res.json({ mensajes, resumen });
  } catch (err) {
    registrarError(req, err);
    res.status(500).json({ error: 'No se pudieron obtener las solicitudes' });
  }
});

// Marca una solicitud como atendida o la devuelve a nueva (protegido).
app.patch('/api/mensajes/:id', verificarSesion, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body || {};
  if (!Number.isInteger(id) || !ESTADOS.includes(estado)) {
    return res.status(400).json({ error: 'Datos no válidos' });
  }
  try {
    const actualizado = await prisma.mensaje.update({
      where: { id },
      data: { estado, atendidoEn: estado === 'ATENDIDO' ? new Date() : null },
    });
    res.json(actualizado);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'La solicitud no existe' });
    registrarError(req, err);
    res.status(500).json({ error: 'No se pudo actualizar la solicitud' });
  }
});

// Agenda: servicios, horarios libres y citas.
app.use('/api', crearRutasCitas(prisma, verificarSesion));
app.use('/api', crearRutasClientes(prisma, verificarSesion));
app.use('/api', crearRutasAvisos(prisma, verificarSesion));

// Asistente de WhatsApp: webhook oficial de Meta y simulador para la página.
app.use('/webhook/whatsapp', crearRutasWhatsApp(prisma));

const limiteSimulador = rateLimit({ skip: () => process.env.NODE_ENV === 'test', windowMs: 10 * 60 * 1000, limit: 60, message: { error: 'Demasiados mensajes. Espera unos minutos.' } });

// El simulador usa el mismo motor que WhatsApp. Cada pestaña tiene su propia
// conversación (id aleatorio que genera la página).
app.post('/api/bot/simulador', limiteSimulador, async (req, res) => {
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

// Sesión y equipo. La cuenta inicial se crea desde la consola con "npm run crear-admin":
// no existe una ruta pública para crear cuentas.
app.use('/api', crearRutasSesion(prisma, verificarSesion));
app.use('/api', crearRutasEquipo(prisma, verificarSesion));

app.use(rutaNoEncontrada);
app.use(manejarErrores);

module.exports = { app, prisma };
