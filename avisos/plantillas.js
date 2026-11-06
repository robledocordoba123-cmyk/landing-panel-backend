// Texto de cada correo. Nombre y mascota los escribe quien reserva: se escapan
// para que nadie pueda meter HTML en un correo que envía el negocio.
const negocio = require('../bot/negocio');
const { fechaLegible, horaLegible } = require('../citas/horario');

const TIPOS = {
  RESERVA: { asunto: 'Recibimos tu cita', intro: 'Recibimos tu solicitud. Te avisaremos cuando quede confirmada.' },
  CONFIRMADA: { asunto: 'Tu cita está confirmada', intro: 'Tu cita quedó confirmada. Te esperamos.' },
  REPROGRAMADA: { asunto: 'Cambiamos la fecha de tu cita', intro: 'Cambiamos tu cita a la nueva fecha. Te avisaremos cuando quede confirmada.' },
  RECORDATORIO: { asunto: 'Mañana es tu cita', intro: 'Te recordamos que mañana tienes cita.' },
  CANCELADA: { asunto: 'Tu cita fue cancelada', intro: 'Tu cita fue cancelada y ese horario quedó libre.' },
};

const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function plantilla(tipo, cita, enlace) {
  const { asunto, intro } = TIPOS[tipo];
  const gestionar = tipo === 'CANCELADA'
    ? ''
    : `<p><a href="${escapar(enlace)}">Cancelar o cambiar mi cita</a></p>`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#292524;max-width:480px">
      <h2 style="color:#0f766e">${escapar(negocio.nombre)}</h2>
      <p>Hola, ${escapar(cita.mascota.cliente.nombre)}. ${intro}</p>
      <ul>
        <li><strong>Mascota:</strong> ${escapar(cita.mascota.nombre)}</li>
        <li><strong>Servicio:</strong> ${escapar(cita.servicio.nombre)}</li>
        <li><strong>Fecha:</strong> ${escapar(fechaLegible(cita.inicio))}, ${escapar(horaLegible(cita.inicio))}</li>
      </ul>
      ${gestionar}
      <p style="color:#78716c;font-size:13px">${escapar(negocio.ubicacion)}</p>
    </div>`;
  return { asunto: `${asunto} · ${negocio.nombre}`, html };
}

module.exports = { plantilla, TIPOS };
