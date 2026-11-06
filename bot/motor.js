// Motor del asistente: recibe un mensaje de texto y devuelve las respuestas.
// Es el mismo para WhatsApp y para el simulador de la página. La conversación
// se guarda en la tabla ConversacionBot (estado y datos), así el bot recuerda
// en qué paso va aunque el servidor se reinicie.
const negocio = require('./negocio');
const { responderConIA } = require('./ia');
const { interpretarFecha } = require('./fechas');
const { ErrorAgenda, crearCita, disponibilidad } = require('../citas/agenda');
const { fechaLegible, fechaLocal, horaLegible, jornadaDe } = require('../citas/horario');
const { leerMascota } = require('../clientes/mascotas');

const MINUTOS_SIN_RESPUESTA = 30; // después de esto, la conversación vuelve a empezar
const HORARIOS_A_OFRECER = 8; // para que la lista quepa bien en el chat
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pesos = (n) => `$${n.toLocaleString('es-CO')}`;

// Minúsculas y sin tildes, para entender "menú", "MENU" o "Menu" igual.
const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const MENU = [
  `¿En qué te puedo ayudar? Escribe el número:`,
  `1️⃣ Servicios y precios\n2️⃣ Horarios y ubicación\n3️⃣ Agendar una cita\n4️⃣ Hablar con una persona`,
];
const OPCIONES_MENU = ['1', '2', '3', '4'];

const textoServicios = (servicios) =>
  `Estos son nuestros servicios:\n${servicios.map((s) => `• *${s.nombre}*: ${s.detalle}, desde ${pesos(s.precioDesde)}`).join('\n')}\n\nSi quieres agendar una cita, escribe *3*.`;
const textoHorarios = () => `🕒 ${negocio.horarios.join('\n🕒 ')}\n📍 ${negocio.ubicacion}\n💳 Recibimos ${negocio.pagos}.`;
const listaServicios = (servicios) => servicios.map((s, i) => `${i + 1}. ${s.nombre}`).join('\n');
const PREGUNTA_FECHA = '¿Para qué día? Escribe *hoy*, *mañana*, un día (ej.: *sábado*) o una fecha (ej.: *15/11*).';
const todosLosServicios = (prisma) => prisma.servicio.findMany({ orderBy: { id: 'asc' } });
const reservables = async (prisma) => (await todosLosServicios(prisma)).filter((s) => s.reservable);

const URGENCIA = /(urgencia|emergencia|sangr|envenen|no respira|convuls|atropell|desmay)/;

async function obtenerConversacion(prisma, id) {
  const conv = await prisma.conversacionBot.findUnique({ where: { id } });
  const vencida = conv && Date.now() - conv.actualizadoEn.getTime() > MINUTOS_SIN_RESPUESTA * 60 * 1000;
  if (!conv || vencida) return { estado: 'INICIO', datos: {}, nueva: true };
  return { estado: conv.estado, datos: conv.datos || {}, nueva: false };
}

function guardar(prisma, id, estado, datos) {
  return prisma.conversacionBot.upsert({
    where: { id },
    update: { estado, datos },
    create: { id, estado, datos },
  });
}

// Crea la solicitud que el negocio verá en su panel, marcada como WhatsApp.
function crearSolicitud(prisma, { nombre, email, telefono, mascota, servicio, mensaje }) {
  return prisma.mensaje.create({
    data: {
      nombre: nombre || 'Cliente de WhatsApp',
      email: email || 'sin-correo@whatsapp',
      telefono: telefono || null,
      mascota: mascota || null,
      servicio: servicio || null,
      mensaje,
      origen: 'WHATSAPP',
    },
  });
}

// id: número de WhatsApp o "sim:<id>". telefono: el número real (null en el simulador).
async function procesarMensaje(prisma, { id, telefono = null, texto }) {
  const original = String(texto || '').trim().slice(0, 500);
  const t = normalizar(original);
  const { estado, datos, nueva } = await obtenerConversacion(prisma, id);
  const responder = async (respuestas, nuevoEstado = 'INICIO', nuevosDatos = {}) => {
    await guardar(prisma, id, nuevoEstado, nuevosDatos);
    return { respuestas, estado: nuevoEstado };
  };

  // Comandos que funcionan en cualquier momento.
  if (/^(cancelar|salir)$/.test(t)) {
    return responder(['Listo, cancelé lo que estábamos haciendo. 👍', ...MENU]);
  }
  if (URGENCIA.test(t)) {
    await crearSolicitud(prisma, { ...datos, telefono, servicio: 'Urgencias', mensaje: `URGENCIA por WhatsApp: "${original}"` });
    return responder([
      '🚨 Si tu mascota está en peligro, *ven de inmediato*: atendemos urgencias todos los días.',
      'Ya le avisé al equipo con tu mensaje para que te contacten enseguida.',
    ]);
  }
  // Saludo con el menú: al empezar una conversación (salvo que ya pida algo
  // concreto, como "3" o "quiero una cita"), al saludar o al escribir "menú".
  const esSaludo = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|empezar)\b/.test(t);
  const pideAlgo = OPCIONES_MENU.includes(t) || /(cita|agendar|turno|horario|servicio|precio|persona|asesor)/.test(t);
  if ((nueva && !pideAlgo) || (esSaludo && estado === 'INICIO') || /^(menu|inicio)$/.test(t)) {
    return responder([`¡Hola! 🐾 Soy el asistente de *${negocio.nombre}*.`, ...MENU]);
  }

  // Pasos para agendar una cita.
  if (estado === 'CITA_NOMBRE') {
    if (original.length < 2 || original.length > 80) return responder(['Escríbeme tu nombre, por favor.'], estado, datos);
    return responder([`Mucho gusto, ${original.split(' ')[0]}. ¿Cómo se llama tu mascota y qué animal es? (ej.: Toby, perro)`], 'CITA_MASCOTA', { ...datos, nombre: original });
  }
  if (estado === 'CITA_MASCOTA') {
    if (original.length < 2 || original.length > 60) return responder(['Cuéntame el nombre de tu mascota y qué animal es.'], estado, datos);
    return responder([`¿Qué servicio necesitas? Escribe el número:\n${listaServicios(await reservables(prisma))}`], 'CITA_SERVICIO', { ...datos, mascota: original });
  }
  if (estado === 'CITA_SERVICIO') {
    const opciones = await reservables(prisma);
    const servicio = opciones[Number(t) - 1] || opciones.find((o) => normalizar(o.nombre).includes(t) && t.length >= 4);
    if (!servicio) return responder([`No encontré ese servicio. Escribe el número:\n${listaServicios(opciones)}`], estado, datos);
    return responder([PREGUNTA_FECHA], 'CITA_FECHA', { ...datos, servicioId: servicio.id, servicio: servicio.nombre });
  }
  if (estado === 'CITA_FECHA' || estado === 'CITA_HORA') {
    const elegido = estado === 'CITA_HORA' ? datos.opciones[Number(t) - 1] : null;
    if (elegido) {
      const inicio = new Date(elegido);
      const { opciones, ...resto } = datos;
      return responder(
        [`Perfecto: *${fechaLegible(inicio)}* a las *${horaLegible(inicio)}*. ¿A qué correo te enviamos la confirmación?`],
        'CITA_CORREO',
        { ...resto, inicio: elegido },
      );
    }
    const fecha = interpretarFecha(t, fechaLocal(new Date()));
    if (!fecha) {
      const repetir = estado === 'CITA_HORA' ? 'Escribe el número del horario, u otra fecha si prefieres.' : `No entendí la fecha. ${PREGUNTA_FECHA}`;
      return responder([repetir], estado, datos);
    }
    const servicio = await prisma.servicio.findUnique({ where: { id: datos.servicioId } });
    const libres = (await disponibilidad(prisma, servicio, fecha)).slice(0, HORARIOS_A_OFRECER);
    if (!libres.length) return responder([`Ese día no tengo horarios libres para ${servicio.nombre}. Prueba con otro día, por favor.`], 'CITA_FECHA', datos);
    const lista = libres.map((h, i) => `${i + 1}. ${horaLegible(h)}`).join('\n');
    const reducida = jornadaDe(fecha).abre !== 8 * 60 ? ' (ese día atendemos de 9:00 a. m. a 2:00 p. m.)' : '';
    return responder(
      [`Estos son los horarios libres del *${fechaLegible(libres[0])}*${reducida}:\n${lista}\n\nEscribe el número, u otra fecha si prefieres.`],
      'CITA_HORA',
      { ...datos, opciones: libres.map((h) => h.toISOString()) },
    );
  }
  if (estado === 'CITA_CORREO') {
    if (!CORREO.test(original)) return responder(['Ese correo no parece válido. Escríbelo de nuevo, por favor (ej.: nombre@gmail.com).'], estado, datos);
    const d = { ...datos, email: original.toLowerCase() };
    const inicio = new Date(d.inicio);
    return responder([
      `Revisa tu cita:\n👤 ${d.nombre}\n🐾 ${d.mascota}\n🩺 ${d.servicio}\n📅 ${fechaLegible(inicio)}, ${horaLegible(inicio)}\n✉️ ${d.email}`,
      '¿Está bien? Responde *sí* para reservarla o *no* para empezar de nuevo.',
    ], 'CITA_CONFIRMAR', d);
  }
  if (estado === 'CITA_CONFIRMAR') {
    if (/^(si|sí|s|ok|dale|listo|confirmo)/.test(t)) {
      const servicio = await prisma.servicio.findUnique({ where: { id: datos.servicioId } });
      const inicio = new Date(datos.inicio);
      try {
        const { nombre: mascota, especie } = leerMascota(datos.mascota);
        await crearCita(prisma, { servicio, inicio, nombre: datos.nombre, email: datos.email, telefono, mascota, especie, origen: 'WHATSAPP' });
      } catch (err) {
        if (!(err instanceof ErrorAgenda)) throw err;
        const { inicio: _inicio, ...resto } = datos;
        return responder([err.message, PREGUNTA_FECHA], 'CITA_FECHA', resto);
      }
      return responder([
        `¡Listo! ✅ Reservé tu cita de *${datos.servicio}* para ${datos.mascota}: *${fechaLegible(inicio)}* a las *${horaLegible(inicio)}*.`,
        'El equipo la confirmará pronto. Si necesitas algo más, escribe *menú*.',
      ]);
    }
    if (/^(no|n)$/.test(t)) {
      return responder(['Sin problema, empecemos de nuevo. ¿Cuál es tu nombre?'], 'CITA_NOMBRE', {});
    }
    return responder(['Responde *sí* para reservar la cita o *no* para empezar de nuevo.'], estado, datos);
  }
  if (estado === 'HUMANO') {
    return responder(['Ya le avisé al equipo y te escribirán por aquí pronto. Si quieres volver al menú, escribe *menú*.'], 'HUMANO', datos);
  }

  // Menú principal y preguntas sueltas.
  if (t === '1' || /(servicio|precio|cuanto|vale|cuesta|vacuna|pelu|bano|consulta)/.test(t)) return responder([textoServicios(await todosLosServicios(prisma))]);
  if (t === '2' || /(horario|hora|abren|cierran|ubicacion|direccion|donde|queda|domingo|festivo|pago|nequi)/.test(t)) return responder([textoHorarios()]);
  if (t === '3' || /(cita|agendar|agenda|turno|reservar)/.test(t)) return responder(['¡Claro! Te ayudo a reservar la cita. ¿Cuál es tu nombre?'], 'CITA_NOMBRE', {});
  if (t === '4' || /(persona|humano|asesor|agente)/.test(t)) {
    await crearSolicitud(prisma, { telefono, mensaje: `Pidió hablar con una persona por WhatsApp. Último mensaje: "${original}"` });
    return responder(['Te paso con una persona del equipo. 🙋 Te escribirán por aquí en horario de atención.'], 'HUMANO', {});
  }

  const deIA = await responderConIA(original, await todosLosServicios(prisma));
  if (deIA) return responder([deIA, 'Si quieres ver las opciones, escribe *menú*.']);
  return responder(['No te entendí del todo. 😅', ...MENU]);
}

module.exports = { procesarMensaje, normalizar, OPCIONES_MENU };
