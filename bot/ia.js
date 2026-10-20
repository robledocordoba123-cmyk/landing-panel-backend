// Respuestas con inteligencia artificial para las preguntas que no entiende el
// menú. Es opcional: solo se usa si el negocio define ANTHROPIC_API_KEY. Sin
// clave, el asistente funciona solo con sus reglas.
const negocio = require('./negocio');

const MODELO = process.env.BOT_IA_MODELO || 'claude-haiku-5-5';

function iaDisponible() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function instrucciones() {
  const servicios = negocio.servicios.map((s) => `- ${s.nombre}: ${s.detalle} (desde $${s.desde.toLocaleString('es-CO')})`).join('\n');
  return [
    `Eres el asistente de WhatsApp de ${negocio.nombre}, una veterinaria en Colombia.`,
    'Responde en español, amable y en máximo 3 frases cortas. No inventes precios, horarios ni servicios que no estén aquí.',
    'Si la pregunta no tiene que ver con la veterinaria o no sabes la respuesta, dilo y sugiere escribir "menú" o "persona".',
    'Nunca des diagnósticos ni medicamentos: si la mascota está mal, recomienda pedir cita o ir a urgencias.',
    `Servicios:\n${servicios}`,
    `Horarios: ${negocio.horarios.join('; ')}.`,
    `Ubicación: ${negocio.ubicacion}. Medios de pago: ${negocio.pagos}.`,
  ].join('\n');
}

// Devuelve el texto de la IA, o null si no hay clave o si la llamada falla
// (el asistente sigue funcionando con su respuesta por defecto).
async function responderConIA(pregunta) {
  if (!iaDisponible()) return null;
  try {
    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 300,
        system: instrucciones(),
        messages: [{ role: 'user', content: pregunta.slice(0, 500) }],
      }),
    });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    const texto = (datos.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return texto || null;
  } catch {
    return null;
  }
}

module.exports = { responderConIA, iaDisponible, instrucciones };
