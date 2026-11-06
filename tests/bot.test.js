const crypto = require('crypto');
const request = require('supertest');
const { app, prisma } = require('../app');
const { interpretarFecha } = require('../bot/fechas');
const { fechaLocal, instante, jornadaDe, sumarDias } = require('../citas/horario');

const SIM = 'prueba-sesion-1234';

// Primer día hábil normal a partir de dentro de 3 días, escrito como en el chat.
function diaHabil() {
  let fecha = sumarDias(fechaLocal(new Date()), 3);
  while (jornadaDe(fecha).abre !== 8 * 60) fecha = sumarDias(fecha, 1);
  return fecha;
}
const comoEnChat = (fecha) => `${fecha.slice(8)}/${fecha.slice(5, 7)}`;

async function decir(texto, sesion = SIM) {
  const res = await request(app).post('/api/bot/simulador').send({ sesion, texto });
  return res.body.respuestas.join('\n');
}

beforeEach(async () => {
  await prisma.conversacionBot.deleteMany();
  await prisma.mensaje.deleteMany();
  await prisma.cita.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Asistente de WhatsApp: conversación', () => {
  test('saluda con el menú al empezar', async () => {
    const r = await decir('hola');
    expect(r).toMatch(/Huellitas/);
    expect(r).toMatch(/1️⃣ Servicios y precios/);
  });

  test('responde servicios con precios y horarios desde el menú o con palabras', async () => {
    await decir('hola');
    expect(await decir('1')).toMatch(/Vacunación.*desde \$45\.000/s);
    expect(await decir('¿a qué hora abren el domingo?')).toMatch(/Domingos y festivos/);
  });

  test('reserva una cita completa con un horario real y queda en la agenda como WhatsApp', async () => {
    const fecha = diaHabil();
    await decir('hola');
    await decir('3');
    await decir('Laura Gómez');
    await decir('Toby, perro');
    expect(await decir('2')).toMatch(/Para qué día/);
    const horarios = await decir(comoEnChat(fecha));
    expect(horarios).toMatch(/1\. 8:00 a\. m\./);
    expect(await decir('3')).toMatch(/9:00 a\. m\./);
    const resumen = await decir('Laura@Correo.com');
    expect(resumen).toMatch(/Toby, perro/);
    expect(resumen).toMatch(/Vacunación/);
    expect(resumen).toMatch(/9:00 a\. m\./);
    expect(await decir('sí')).toMatch(/Reservé tu cita de \*Vacunación\*/);

    const citas = await prisma.cita.findMany({ include: { servicio: true } });
    expect(citas).toHaveLength(1);
    expect(citas[0]).toMatchObject({ nombre: 'Laura Gómez', email: 'laura@correo.com', mascota: 'Toby, perro', origen: 'WHATSAPP', estado: 'PENDIENTE' });
    expect(citas[0].servicio.nombre).toBe('Vacunación');
    expect(citas[0].inicio).toEqual(instante(fecha, 9 * 60));
  });

  test('valida los datos: servicio, fecha, horario y correo mal escritos', async () => {
    await decir('quiero una cita');
    await decir('Andrés');
    await decir('Misha, gata');
    expect(await decir('9')).toMatch(/No encontré ese servicio/);
    await decir('consulta');
    expect(await decir('algún día')).toMatch(/No entendí la fecha/);
    await decir(comoEnChat(diaHabil()));
    expect(await decir('99')).toMatch(/Escribe el número del horario/);
    await decir('1');
    expect(await decir('andres-sin-arroba')).toMatch(/no parece válido/);
    expect(await prisma.cita.count()).toBe(0);
  });

  test('las urgencias no aparecen como servicio para reservar', async () => {
    await decir('3');
    await decir('Sara');
    expect(await decir('Kiwi, loro')).not.toMatch(/Urgencias/);
  });

  test('no ofrece un horario que ya está ocupado', async () => {
    const fecha = diaHabil();
    const servicio = await prisma.servicio.findUnique({ where: { nombre: 'Consulta general' } });
    await prisma.cita.create({ data: { servicioId: servicio.id, recurso: servicio.recurso, inicio: instante(fecha, 8 * 60), fin: instante(fecha, 8 * 60 + 30), nombre: 'Otra', email: 'otra@correo.com', mascota: 'Rex' } });
    await decir('3');
    await decir('Sara');
    await decir('Kiwi, loro');
    await decir('1');
    const horarios = await decir(comoEnChat(fecha));
    expect(horarios).not.toMatch(/8:00 a\. m\./);
    expect(horarios).toMatch(/1\. 8:30 a\. m\./);
  });

  test('si alguien más toma el horario antes de confirmar, pide otra fecha sin perder lo demás', async () => {
    const fecha = diaHabil();
    await decir('3');
    await decir('Sara');
    await decir('Kiwi, loro');
    await decir('1');
    await decir(comoEnChat(fecha));
    await decir('1');
    await decir('sara@correo.com');
    const servicio = await prisma.servicio.findUnique({ where: { nombre: 'Consulta general' } });
    await prisma.cita.create({ data: { servicioId: servicio.id, recurso: servicio.recurso, inicio: instante(fecha, 8 * 60), fin: instante(fecha, 8 * 60 + 30), nombre: 'Otra', email: 'otra@correo.com', mascota: 'Rex' } });
    expect(await decir('sí')).toMatch(/acaba de reservar.*Para qué día/s);
    expect(await decir(comoEnChat(fecha))).toMatch(/1\. 8:30 a\. m\./);
    await decir('1');
    await decir('sara@correo.com');
    expect(await decir('sí')).toMatch(/Reservé tu cita/);
    expect(await prisma.cita.count({ where: { nombre: 'Sara' } })).toBe(1);
  });

  test('"no" en la confirmación vuelve a empezar y "cancelar" funciona en cualquier paso', async () => {
    await decir('3');
    await decir('Sara');
    expect(await decir('cancelar')).toMatch(/cancelé/);
    await decir('3');
    await decir('Sara');
    await decir('Kiwi, loro');
    await decir('1');
    await decir(comoEnChat(diaHabil()));
    await decir('1');
    await decir('sara@correo.com');
    expect(await decir('no')).toMatch(/empecemos de nuevo/);
    expect(await prisma.cita.count()).toBe(0);
  });

  test('una urgencia avisa al equipo aunque esté a mitad de otra cosa', async () => {
    await decir('3');
    const r = await decir('mi perro se envenenó, ayuda');
    expect(r).toMatch(/ven de inmediato/);
    const [s] = await prisma.mensaje.findMany();
    expect(s).toMatchObject({ servicio: 'Urgencias', origen: 'WHATSAPP' });
  });

  test('pedir una persona crea una solicitud para que el equipo responda', async () => {
    await decir('hola');
    expect(await decir('4')).toMatch(/Te paso con una persona/);
    expect(await prisma.mensaje.count()).toBe(1);
  });

  test('sin IA configurada, lo que no entiende lo devuelve al menú', async () => {
    await decir('hola');
    expect(await decir('¿cuál es la capital de Francia?')).toMatch(/No te entendí/);
  });

  test('con IA configurada usa su respuesta para preguntas libres', async () => {
    process.env.ANTHROPIC_API_KEY = 'clave-de-prueba';
    const real = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Sí, atendemos conejos.' }] }) }));
    try {
      await decir('hola');
      expect(await decir('¿atienden conejos?')).toMatch(/Sí, atendemos conejos/);
      const [url, opciones] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(opciones.headers['x-api-key']).toBe('clave-de-prueba');
    } finally {
      global.fetch = real;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('el simulador rechaza mensajes vacíos o sesiones inválidas', async () => {
    expect((await request(app).post('/api/bot/simulador').send({ sesion: SIM, texto: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/bot/simulador').send({ sesion: 'x', texto: 'hola' })).status).toBe(400);
  });
});

describe('Asistente de WhatsApp: webhook de Meta', () => {
  const ENV = { WHATSAPP_TOKEN: 'token', WHATSAPP_PHONE_ID: '123', WHATSAPP_VERIFY_TOKEN: 'verificar', WHATSAPP_APP_SECRET: 'secreto' };
  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => Object.keys(ENV).forEach((k) => delete process.env[k]));

  const firmar = (cuerpo) => 'sha256=' + crypto.createHmac('sha256', 'secreto').update(cuerpo).digest('hex');
  const mensaje = (texto) => JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '573000000001', type: 'text', text: { body: texto } }] } }] }] });

  test('verifica el webhook solo con la palabra secreta correcta', async () => {
    const ok = await request(app).get('/webhook/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verificar', 'hub.challenge': 'reto123' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('reto123');
    const mal = await request(app).get('/webhook/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otra', 'hub.challenge': 'x' });
    expect(mal.status).toBe(403);
  });

  test('rechaza mensajes con firma falsa', async () => {
    const res = await request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('x-hub-signature-256', 'sha256=falsa').send(mensaje('hola'));
    expect(res.status).toBe(401);
  });

  test('responde por WhatsApp a un mensaje real firmado', async () => {
    const real = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' }));
    try {
      const cuerpo = mensaje('hola');
      const res = await request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('x-hub-signature-256', firmar(cuerpo)).send(cuerpo);
      expect(res.status).toBe(200);
      for (let i = 0; i < 20 && global.fetch.mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
      const [url, opciones] = global.fetch.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v21.0/123/messages');
      expect(opciones.headers.Authorization).toBe('Bearer token');
      expect(JSON.parse(opciones.body)).toMatchObject({ messaging_product: 'whatsapp', to: '573000000001', type: 'text' });
    } finally {
      global.fetch = real;
    }
  });

  test('sin configuración el webhook no existe', async () => {
    Object.keys(ENV).forEach((k) => delete process.env[k]);
    expect((await request(app).get('/webhook/whatsapp')).status).toBe(404);
  });
});

describe('Fechas escritas en el chat', () => {
  const hoy = '2026-11-05'; // jueves

  test.each([
    ['hoy', '2026-11-05'],
    ['manana', '2026-11-06'],
    ['pasado manana', '2026-11-07'],
    ['el sabado', '2026-11-07'],
    ['jueves', '2026-11-05'],
    ['miercoles', '2026-11-11'],
    ['15/11', '2026-11-15'],
    ['15-11', '2026-11-15'],
    ['15/11/2026', '2026-11-15'],
    ['20 de noviembre', '2026-11-20'],
    ['3/1', '2027-01-03'],
  ])('"%s" es %s', (texto, esperado) => {
    expect(interpretarFecha(texto, hoy)).toBe(esperado);
  });

  test.each(['31/02', '45/11', 'algun dia', '15 de brumario', ''])('"%s" no es una fecha', (texto) => {
    expect(interpretarFecha(texto, hoy)).toBeNull();
  });
});
