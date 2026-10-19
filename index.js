require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('Falta JWT_SECRET en las variables de entorno.');
  process.exit(1);
}

// Solo el frontend configurado puede llamar a la API desde el navegador.
const origenes = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(helmet());
app.use(cors(origenes.length ? { origin: origenes } : {}));
app.use(express.json({ limit: '20kb' }));
// En Render la API va detrás de un proxy: así el límite de intentos ve la IP real.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

const SERVICIOS = ['Consulta general', 'Vacunación', 'Peluquería', 'Urgencias', 'Otro'];
const ESTADOS = ['NUEVO', 'ATENDIDO'];
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// El formulario es público: se limita para que nadie lo use para llenar la
// base de datos. El login también, para frenar a quien pruebe contraseñas.
const limiteFormulario = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { error: 'Enviaste muchas solicitudes. Intenta de nuevo en unos minutos.' } });
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' } });

function verificarToken(req, res, next) {
  const [esquema, token] = (req.headers.authorization || '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'No autorizado, falta el token' });
  }
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Revisa los datos del formulario y devuelve el primer error que encuentre.
function validarSolicitud({ nombre, email, telefono, mascota, servicio, mensaje }) {
  const texto = (v) => (typeof v === 'string' ? v.trim() : '');
  if (texto(nombre).length < 2 || texto(nombre).length > 80) return 'Escribe tu nombre (entre 2 y 80 letras).';
  if (!CORREO.test(texto(email)) || texto(email).length > 120) return 'Escribe un correo válido.';
  if (telefono && !/^[\d\s+()-]{7,20}$/.test(texto(telefono))) return 'El teléfono no es válido.';
  if (mascota && texto(mascota).length > 60) return 'El nombre de la mascota es muy largo.';
  if (servicio && !SERVICIOS.includes(servicio)) return 'Elige un servicio de la lista.';
  if (texto(mensaje).length < 5 || texto(mensaje).length > 1000) return 'Cuéntanos qué necesitas (entre 5 y 1000 letras).';
  return null;
}

app.get('/', (req, res) => {
  res.json({ estado: 'ok', servicio: 'API de Huellitas Veterinaria' });
});

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
      },
      select: { id: true, creadoEn: true },
    });
    res.status(201).json(nueva);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la solicitud' });
  }
});

// Lista las solicitudes para el panel (protegido). ?estado=NUEVO|ATENDIDO
app.get('/api/mensajes', verificarToken, async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'No se pudieron obtener las solicitudes' });
  }
});

// Marca una solicitud como atendida o la devuelve a nueva (protegido).
app.patch('/api/mensajes/:id', verificarToken, async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la solicitud' });
  }
});

// Login del panel. Antes había una ruta pública /api/registro que dejaba a
// cualquiera crearse un administrador; ahora la cuenta se crea solo desde la
// consola del servidor con "npm run crear-admin".
app.post('/api/login', limiteLogin, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
  }
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    const correcto = usuario && (await bcrypt.compare(password, usuario.password));
    if (!correcto) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, email: usuario.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
