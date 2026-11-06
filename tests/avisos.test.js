const request = require('supertest');
const bcrypt = require('bcrypt');
const { app, prisma } = require('../app');
const { crearToken, leerToken, enlaceCita } = require('../avisos/enlace');
const { enviarRecordatorios } = require('../avisos/avisos');
const { plantilla } = require('../avisos/plantillas');
const { fechaLocal, instante, jornadaDe, sumarDias } = require('../citas/horario');

const ADMIN = { email: 'avisos@huellitas.test', password: 'clave-de-pruebas' };

function diaHabil(desde = 3) {
  let fecha = sumarDias(fechaLocal(new Date()), desde);
  while (jornadaDe(fecha).abre !== 8 * 60) fecha = sumarDias(fecha, 1);
  return fecha;
}

let tokenPanel;
let consulta;

const conSesion = (r) => r.set('Authorization', `Bearer ${tokenPanel}`);
const reservar = (extra) => request(app).post('/api/citas').send({
  servicioId: consulta.id,
  inicio: instante(diaHabil(), 9 * 60).toISOString(),
  nombre: 'Laura Gómez',
  email: 'laura@correo.com',
  telefono: '300 000 0001',
  mascota: 'Toby',
  especie: 'Perro',
  ...extra,
});

const limpiar = async () => {
  await prisma.cita.deleteMany();
  await prisma.mascota.deleteMany();
  await prisma.cliente.deleteMany();
};

// Crea una cita directo en la base, para fechas que la API no aceptaría.
async function citaEn(inicio, estado = 'CONFIRMADA') {
  const cliente = await prisma.cliente.create({ data: { nombre: 'Ana', email: `ana${inicio.getTime()}@correo.com`, mascotas: { create: { nombre: 'Misha', especie: 'Gato' } } }, include: { mascotas: true } });
  return prisma.cita.create({ data: { servicioId: consulta.id, recurso: consulta.recurso, inicio, fin: new Date(inicio.getTime() + 30 * 60 * 1000), estado, mascotaId: cliente.mascotas[0].id } });
}

beforeAll(async () => {
  consulta = await prisma.servicio.findUnique({ where: { nombre: 'Consulta general' } });
  await prisma.usuario.deleteMany({ where: { email: ADMIN.email } });
  await prisma.usuario.create({ data: { email: ADMIN.email, password: await bcrypt.hash(ADMIN.password, 4) } });
  tokenPanel = (await request(app).post('/api/login').send(ADMIN)).body.token;
});

beforeEach(limpiar);

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.BREVO_API_KEY;
  delete process.env.TAREAS_TOKEN;
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

describe('Enlace de la cita', () => {
  test('el código solo sirve para su cita', () => {
    expect(leerToken(crearToken(25))).toBe(25);
    const [, firma] = crearToken(25).split('.');
    expect(leerToken(`26.${firma}`)).toBeNull();
    expect(leerToken('25.firma-inventada')).toBeNull();
    expect(leerToken('25')).toBeNull();
    expect(leerToken('')).toBeNull();
  });

  test('usa la dirección de la página', () => {
    process.env.WEB_URL = 'https://mi-vet.co';
    expect(enlaceCita(7)).toMatch(/^https:\/\/mi-vet\.co\/mi-cita\/7\./);
    delete process.env.WEB_URL;
  });
});

describe('El cliente maneja su cita con el enlace', () => {
  const abrir = (token) => request(app).get(`/api/mi-cita/${token}`);
  const cancelar = (token) => request(app).post(`/api/mi-cita/${token}/cancelar`);
  const cambiar = (token, inicio) => request(app).post(`/api/mi-cita/${token}/cambiar`).send({ inicio });

  test('reservar entrega el código y abrirlo muestra la cita sin datos de contacto', async () => {
    const { body } = await reservar();
    const res = await abrir(body.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ servicio: 'Consulta general', mascota: 'Toby', estado: 'PENDIENTE', sePuedeGestionar: true });
    expect(JSON.stringify(res.body)).not.toMatch(/laura@correo|300 000/);
  });

  test('un código falso no revela nada', async () => {
    expect((await abrir('1.falso')).status).toBe(404);
    expect((await cancelar('1.falso')).status).toBe(404);
    expect((await cambiar('1.falso', new Date().toISOString())).status).toBe(404);
  });

  test('cancelar libera el horario y ya no se puede volver a cambiar', async () => {
    const { body } = await reservar();
    const res = await cancelar(body.token);
    expect(res.body).toMatchObject({ estado: 'CANCELADA', sePuedeGestionar: false });
    expect((await reservar({ email: 'otra@correo.com' })).status).toBe(201);
    expect((await cancelar(body.token)).status).toBe(409);
  });

  test('cambiar mueve la cita, libera la hora anterior y la deja pendiente', async () => {
    const { body } = await reservar();
    await conSesion(request(app).patch(`/api/citas/${body.id}/estado`)).send({ estado: 'CONFIRMADA' });
    const nueva = instante(diaHabil(), 11 * 60).toISOString();
    const res = await cambiar(body.token, nueva);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'PENDIENTE', inicio: nueva });
    expect((await reservar({ email: 'otra@correo.com' })).status).toBe(201);
  });

  test('no cambia a un horario ocupado, inválido o igual al actual', async () => {
    const { body } = await reservar();
    await reservar({ email: 'otra@correo.com', inicio: instante(diaHabil(), 11 * 60).toISOString() });
    expect((await cambiar(body.token, instante(diaHabil(), 11 * 60).toISOString())).status).toBe(409);
    expect((await cambiar(body.token, instante(diaHabil(), 6 * 60).toISOString())).status).toBe(400);
    expect((await cambiar(body.token, body.inicio)).status).toBe(400);
    expect((await cambiar(body.token, 'mañana')).status).toBe(400);
  });

  test('faltando menos de 2 horas ya no se cambia en línea', async () => {
    const cita = await citaEn(new Date(Date.now() + 60 * 60 * 1000));
    const token = crearToken(cita.id);
    expect((await abrir(token)).body.sePuedeGestionar).toBe(false);
    expect((await cancelar(token)).status).toBe(409);
  });
});

describe('Correos', () => {
  const tipos = async () => (await prisma.notificacion.findMany({ orderBy: { id: 'asc' } })).map((n) => n.tipo);

  test('sin clave de Brevo no sale ningún correo: quedan registrados como simulados', async () => {
    const espia = jest.spyOn(global, 'fetch');
    await reservar();
    expect(espia).not.toHaveBeenCalled();
    expect(await prisma.notificacion.findFirst()).toMatchObject({ tipo: 'RESERVA', estado: 'SIMULADA', destinatario: 'laura@correo.com' });
  });

  test('con clave envía el correo con su enlace', async () => {
    process.env.BREVO_API_KEY = 'clave-de-prueba';
    const espia = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
    const { body } = await reservar();
    const cuerpo = JSON.parse(espia.mock.calls[0][1].body);
    expect(cuerpo.to).toEqual([{ email: 'laura@correo.com' }]);
    expect(cuerpo.htmlContent).toContain(`/mi-cita/${body.token}`);
    expect((await prisma.notificacion.findFirst()).estado).toBe('ENVIADA');
  });

  test('si el correo falla, la reserva igual queda guardada', async () => {
    process.env.BREVO_API_KEY = 'clave-de-prueba';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('sin red'));
    expect((await reservar()).status).toBe(201);
    expect(await prisma.cita.count()).toBe(1);
    expect((await prisma.notificacion.findFirst()).estado).toBe('FALLIDA');
  });

  test('avisa al confirmar, al cancelar y al cambiar', async () => {
    const { body } = await reservar();
    await conSesion(request(app).patch(`/api/citas/${body.id}/estado`)).send({ estado: 'CONFIRMADA' });
    await request(app).post(`/api/mi-cita/${body.token}/cambiar`).send({ inicio: instante(diaHabil(), 11 * 60).toISOString() });
    await request(app).post(`/api/mi-cita/${body.token}/cancelar`);
    expect(await tipos()).toEqual(['RESERVA', 'CONFIRMADA', 'REPROGRAMADA', 'CANCELADA']);
  });

  test('escapa el HTML que escribe quien reserva', () => {
    const cita = { inicio: new Date(), mascota: { nombre: '<b>Toby</b>', cliente: { nombre: '<script>alert(1)</script>' } }, servicio: { nombre: 'Consulta' } };
    const { html } = plantilla('RESERVA', cita, 'https://x.co/mi-cita/1.a');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Toby');
  });

  test('un correo de cancelación no ofrece el enlace', () => {
    const cita = { inicio: new Date(), mascota: { nombre: 'Toby', cliente: { nombre: 'Ana' } }, servicio: { nombre: 'Consulta' } };
    expect(plantilla('CANCELADA', cita, 'https://x.co/mi-cita/1.a').html).not.toContain('mi-cita');
  });

  test('el registro de correos exige sesión', async () => {
    await reservar();
    expect((await request(app).get('/api/notificaciones')).status).toBe(401);
    const res = await conSesion(request(app).get('/api/notificaciones'));
    expect(res.body.envioReal).toBe(false);
    expect(res.body.notificaciones[0].cita.mascota.nombre).toBe('Toby');
  });
});

describe('Recordatorios', () => {
  // Las 8:00 a. m. del día anterior a la cita, para no depender de la fecha real.
  const fechaCita = diaHabil(5);
  const ahora = instante(sumarDias(fechaCita, -1), 8 * 60);

  test('recuerda las citas de mañana, una sola vez', async () => {
    await citaEn(instante(fechaCita, 9 * 60));
    expect(await enviarRecordatorios(prisma, ahora)).toMatchObject({ revisadas: 1, simuladas: 1 });
    expect(await enviarRecordatorios(prisma, ahora)).toMatchObject({ revisadas: 0 });
    expect(await prisma.notificacion.count({ where: { tipo: 'RECORDATORIO' } })).toBe(1);
  });

  test('no recuerda canceladas ni citas de otro día', async () => {
    await citaEn(instante(fechaCita, 9 * 60), 'CANCELADA');
    await citaEn(instante(sumarDias(fechaCita, 1), 9 * 60));
    expect((await enviarRecordatorios(prisma, ahora)).revisadas).toBe(0);
  });

  test('si el correo falla, se reintenta la próxima vez', async () => {
    await citaEn(instante(fechaCita, 9 * 60));
    process.env.BREVO_API_KEY = 'clave-de-prueba';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: true });
    expect((await enviarRecordatorios(prisma, ahora)).fallidas).toBe(1);
    expect((await enviarRecordatorios(prisma, ahora)).enviadas).toBe(1);
  });

  test('cambiar la fecha permite recordar la nueva', async () => {
    const { body } = await reservar();
    await prisma.cita.update({ where: { id: body.id }, data: { recordatorioEn: new Date() } });
    await request(app).post(`/api/mi-cita/${body.token}/cambiar`).send({ inicio: instante(diaHabil(), 11 * 60).toISOString() });
    expect((await prisma.cita.findUnique({ where: { id: body.id } })).recordatorioEn).toBeNull();
  });

  test('la tarea diaria exige su token, y sin configurar no existe', async () => {
    const tarea = (token) => request(app).post('/api/tareas/recordatorios').set('x-tarea-token', token);
    expect((await tarea('lo-que-sea')).status).toBe(404);
    process.env.TAREAS_TOKEN = 'token-correcto';
    expect((await tarea('token-falso')).status).toBe(401);
    expect((await tarea('token-correcto')).status).toBe(200);
  });

  test('el botón del panel exige sesión', async () => {
    expect((await request(app).post('/api/recordatorios')).status).toBe(401);
    expect((await conSesion(request(app).post('/api/recordatorios'))).status).toBe(200);
  });
});
