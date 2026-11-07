// Avisa al cliente por correo y deja registro. Un correo que falla nunca debe
// dañar la reserva ya guardada: por eso esta función no lanza errores.
const { enviarCorreo } = require('./correo');
const { enlaceCita } = require('./enlace');
const { plantilla } = require('./plantillas');
const { fechaLocal, instante, sumarDias } = require('../citas/horario');
const { describirError, registro } = require('../plataforma/registros');

const DATOS_CITA = { servicio: true, mascota: { include: { cliente: true } } };

async function avisar(prisma, tipo, citaId) {
  try {
    const cita = await prisma.cita.findUnique({ where: { id: citaId }, include: DATOS_CITA });
    const { asunto, html } = plantilla(tipo, cita, enlaceCita(citaId));
    const para = cita.mascota.cliente.email;
    const resultado = await enviarCorreo({ para, asunto, html });
    await prisma.notificacion.create({ data: { citaId, tipo, destinatario: para, asunto, ...resultado } });
    return resultado.estado;
  } catch (err) {
    registro.error('No se pudo registrar el aviso', { aviso: tipo, cita: citaId, ...describirError(err) });
    return 'FALLIDA';
  }
}

// Recordatorio de las citas de mañana. Se puede correr varias veces: cada cita
// se marca antes de enviar, y si el correo falla se libera para reintentar.
async function enviarRecordatorios(prisma, ahora = new Date()) {
  const manana = sumarDias(fechaLocal(ahora), 1);
  const citas = await prisma.cita.findMany({
    where: {
      estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
      recordatorioEn: null,
      inicio: { gte: instante(manana, 0), lt: instante(sumarDias(manana, 1), 0) },
    },
    select: { id: true },
  });
  const resumen = { revisadas: citas.length, enviadas: 0, simuladas: 0, fallidas: 0 };
  for (const { id } of citas) {
    const { count } = await prisma.cita.updateMany({ where: { id, recordatorioEn: null }, data: { recordatorioEn: ahora } });
    if (count) {
      const estado = await avisar(prisma, 'RECORDATORIO', id);
      if (estado === 'ENVIADA') resumen.enviadas += 1;
      if (estado === 'SIMULADA') resumen.simuladas += 1;
      if (estado === 'FALLIDA') {
        resumen.fallidas += 1;
        await prisma.cita.update({ where: { id }, data: { recordatorioEn: null } });
      }
    }
  }
  return resumen;
}

function ultimasNotificaciones(prisma) {
  return prisma.notificacion.findMany({
    orderBy: { creadoEn: 'desc' },
    take: 50,
    include: { cita: { select: { inicio: true, mascota: { select: { nombre: true } } } } },
  });
}

module.exports = { avisar, enviarRecordatorios, ultimasNotificaciones };
