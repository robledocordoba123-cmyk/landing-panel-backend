// Enlace para que el cliente maneje su cita sin crear una cuenta. El código se
// deriva de la cita con una firma HMAC: no se puede adivinar ni sirve para otra
// cita, y no hace falta guardarlo para volver a enviarlo en el recordatorio.
const crypto = require('crypto');

const firma = (id) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`mi-cita:${id}`).digest('base64url');

const crearToken = (id) => `${id}.${firma(id)}`;

// Devuelve el id de la cita, o null si el código no es válido.
function leerToken(token) {
  const [id, recibida, ...resto] = String(token).split('.');
  if (!/^\d{1,9}$/.test(id) || !recibida || resto.length) return null;
  const esperada = Buffer.from(firma(id));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !crypto.timingSafeEqual(esperada, dada)) return null;
  return Number(id);
}

function urlWeb() {
  const principal = (process.env.CORS_ORIGIN || '').split(',')[0].trim();
  return process.env.WEB_URL || principal || 'http://localhost:5173';
}

const enlaceCita = (id) => `${urlWeb()}/mi-cita/${crearToken(id)}`;

module.exports = { crearToken, leerToken, enlaceCita };
