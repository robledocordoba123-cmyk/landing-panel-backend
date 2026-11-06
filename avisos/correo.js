// Envío de correos con Brevo. Sin BREVO_API_KEY nada sale de la API: el correo
// queda registrado como SIMULADA. Así funciona la demo pública, donde cualquiera
// puede escribir un correo ajeno y no se debe poder enviarle mensajes.
const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';
const MS_ESPERA = 5000;

async function enviarCorreo({ para, asunto, html }) {
  if (!process.env.BREVO_API_KEY) return { estado: 'SIMULADA' };
  try {
    const respuesta = await fetch(URL_BREVO, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: process.env.CORREO_NOMBRE || 'Huellitas Veterinaria', email: process.env.CORREO_REMITENTE },
        to: [{ email: para }],
        subject: asunto,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(MS_ESPERA),
    });
    if (!respuesta.ok) return { estado: 'FALLIDA', detalle: `Brevo respondió ${respuesta.status}` };
    return { estado: 'ENVIADA' };
  } catch (err) {
    return { estado: 'FALLIDA', detalle: err.name === 'TimeoutError' ? 'Brevo no respondió a tiempo' : 'No se pudo conectar con Brevo' };
  }
}

module.exports = { enviarCorreo };
