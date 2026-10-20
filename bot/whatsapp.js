// Conexión con la API oficial de WhatsApp Business (WhatsApp Cloud API de Meta).
// Para activarla, el negocio crea su app en developers.facebook.com y define:
//   WHATSAPP_TOKEN        token de acceso de la app
//   WHATSAPP_PHONE_ID     id del número de WhatsApp Business
//   WHATSAPP_VERIFY_TOKEN palabra secreta que se escribe al registrar el webhook
//   WHATSAPP_APP_SECRET   secreto de la app, para comprobar que los mensajes vienen de Meta
const crypto = require('crypto');
const express = require('express');
const { procesarMensaje } = require('./motor');

const VERSION_API = 'v21.0';

function configurado() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET);
}

// Meta firma cada mensaje con el secreto de la app. Si la firma no coincide,
// alguien está intentando hacerse pasar por WhatsApp.
function firmaValida(cuerpoCrudo, firma) {
  if (!firma || !cuerpoCrudo) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function enviarTexto(para, texto) {
  const respuesta = await fetch(`https://graph.facebook.com/${VERSION_API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } }),
  });
  if (!respuesta.ok) {
    console.error('WhatsApp no aceptó el mensaje:', respuesta.status, await respuesta.text().catch(() => ''));
  }
}

function crearRutasWhatsApp(prisma) {
  const router = express.Router();

  // Meta llama a esta ruta una vez para verificar el webhook.
  router.get('/', (req, res) => {
    if (!configurado()) return res.status(404).json({ error: 'WhatsApp no está configurado' });
    const { 'hub.mode': modo, 'hub.verify_token': token, 'hub.challenge': reto } = req.query;
    if (modo === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(reto);
    return res.sendStatus(403);
  });

  // Mensajes que llegan de WhatsApp. Se responde 200 enseguida (Meta reintenta
  // si tardamos) y luego se procesa cada mensaje de texto.
  router.post('/', async (req, res) => {
    if (!configurado()) return res.status(404).json({ error: 'WhatsApp no está configurado' });
    if (!firmaValida(req.cuerpoCrudo, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200);

    const mensajes = (req.body.entry || []).flatMap((e) => (e.changes || []).flatMap((c) => c.value?.messages || []));
    for (const m of mensajes) {
      const texto = m.type === 'text' ? m.text?.body : null;
      try {
        const { respuestas } = texto
          ? await procesarMensaje(prisma, { id: `wa:${m.from}`, telefono: m.from, texto })
          : { respuestas: ['Por ahora solo entiendo mensajes de texto. Escribe *menú* para ver las opciones.'] };
        for (const r of respuestas) await enviarTexto(m.from, r);
      } catch (err) {
        console.error('Error atendiendo un mensaje de WhatsApp:', err.message);
      }
    }
  });

  return router;
}

module.exports = { crearRutasWhatsApp, firmaValida, configurado, VERSION_API };
