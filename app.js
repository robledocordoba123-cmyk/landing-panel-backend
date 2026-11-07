// Arma la API: seguridad y middlewares comunes, y las rutas de cada módulo. Cada
// módulo vive en su carpeta (citas, clientes, avisos, mensajes, ajustes, reportes,
// seguridad, bot) y recibe prisma y la verificación de sesión.
require('dotenv').config({ quiet: true });

const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { crearRutasWhatsApp } = require('./bot/whatsapp');
const { crearRutasSimulador } = require('./bot/simulador');
const { crearRutasCitas } = require('./citas/rutas');
const { crearRutasClientes } = require('./clientes/rutas');
const { crearRutasAvisos } = require('./avisos/rutas');
const { crearRutasMensajes } = require('./mensajes/rutas');
const { crearRutasSesion, crearVerificarSesion } = require('./seguridad/sesion');
const { crearRutasEquipo } = require('./seguridad/equipo');
const { crearRutasAjustes } = require('./ajustes/rutas');
const { crearRutasReportes } = require('./reportes/rutas');
const { manejarErrores, rutaNoEncontrada } = require('./plataforma/errores');
const { registrarPeticiones } = require('./plataforma/registros');
const { crearRutaSalud } = require('./plataforma/salud');

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en las variables de entorno.');
  process.exit(1);
}

const prisma = new PrismaClient();
const app = express();

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
// GET /api/diagnostico/red (administración) muestra la cadena para ajustarlo.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

const verificarSesion = crearVerificarSesion(prisma);

app.get('/', (req, res) => res.json({ estado: 'ok', servicio: 'API de Huellitas Veterinaria' }));
app.get('/api/salud', crearRutaSalud(prisma));

// Las cuentas se crean desde el panel (administración) o con "npm run crear-admin":
// no existe una ruta pública para crearlas.
app.use('/api', crearRutasSesion(prisma, verificarSesion));
app.use('/api', crearRutasEquipo(prisma, verificarSesion));
app.use('/api', crearRutasCitas(prisma, verificarSesion));
app.use('/api', crearRutasClientes(prisma, verificarSesion));
app.use('/api', crearRutasAvisos(prisma, verificarSesion));
app.use('/api', crearRutasMensajes(prisma, verificarSesion));
app.use('/api', crearRutasAjustes(prisma, verificarSesion));
app.use('/api', crearRutasReportes(prisma, verificarSesion));
app.use('/api', crearRutasSimulador(prisma));
app.use('/webhook/whatsapp', crearRutasWhatsApp(prisma));

app.use(rutaNoEncontrada);
app.use(manejarErrores);

module.exports = { app, prisma };
