const bcrypt = require('bcrypt');
const request = require('supertest');
const { app, prisma } = require('../app');

async function token() {
  const res = await request(app).post('/api/login').send({ email: 'admin@prueba.co', password: 'clave-de-prueba-123' });
  return res.body.token;
}

beforeEach(async () => {
  await prisma.mensaje.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.usuario.create({ data: { email: 'admin@prueba.co', password: await bcrypt.hash('clave-de-prueba-123', 4) } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('API de Huellitas', () => {
  test('el formulario guarda una solicitud válida como NUEVO y de origen WEB', async () => {
    const res = await request(app).post('/api/mensajes').send({ nombre: 'Ana', email: 'ANA@correo.com', servicio: 'Peluquería', mensaje: 'Quiero un baño para mi perro' });
    expect(res.status).toBe(201);
    const [m] = await prisma.mensaje.findMany();
    expect(m).toMatchObject({ email: 'ana@correo.com', estado: 'NUEVO', origen: 'WEB' });
  });

  test('el formulario rechaza datos inválidos', async () => {
    const malos = [
      { nombre: 'A', email: 'a@b.co', mensaje: 'hola mundo' },
      { nombre: 'Ana', email: 'sin-arroba', mensaje: 'hola mundo' },
      { nombre: 'Ana', email: 'a@b.co', mensaje: 'hola', servicio: 'Cirugía espacial' },
    ];
    for (const datos of malos) expect((await request(app).post('/api/mensajes').send(datos)).status).toBe(400);
    expect(await prisma.mensaje.count()).toBe(0);
  });

  test('ya no existe una ruta pública para crear administradores', async () => {
    expect((await request(app).post('/api/registro').send({ email: 'x@x.co', password: '12345678' })).status).toBe(404);
  });

  test('el panel exige token; con token lista, filtra y cuenta por estado', async () => {
    expect((await request(app).get('/api/mensajes')).status).toBe(401);
    await prisma.mensaje.createMany({ data: [
      { nombre: 'A', email: 'a@x.co', mensaje: 'uno' },
      { nombre: 'B', email: 'b@x.co', mensaje: 'dos', estado: 'ATENDIDO' },
    ] });
    const t = await token();
    const todas = await request(app).get('/api/mensajes').set('Authorization', `Bearer ${t}`);
    expect(todas.body.resumen).toEqual({ NUEVO: 1, ATENDIDO: 1 });
    const nuevas = await request(app).get('/api/mensajes?estado=NUEVO').set('Authorization', `Bearer ${t}`);
    expect(nuevas.body.mensajes.map((m) => m.nombre)).toEqual(['A']);
  });

  test('marcar como atendida guarda la fecha, y deshacer la borra', async () => {
    const m = await prisma.mensaje.create({ data: { nombre: 'A', email: 'a@x.co', mensaje: 'uno' } });
    const t = await token();
    const atendida = await request(app).patch(`/api/mensajes/${m.id}`).set('Authorization', `Bearer ${t}`).send({ estado: 'ATENDIDO' });
    expect(atendida.body.atendidoEn).not.toBeNull();
    const deshecha = await request(app).patch(`/api/mensajes/${m.id}`).set('Authorization', `Bearer ${t}`).send({ estado: 'NUEVO' });
    expect(deshecha.body.atendidoEn).toBeNull();
    expect((await request(app).patch('/api/mensajes/99999').set('Authorization', `Bearer ${t}`).send({ estado: 'NUEVO' })).status).toBe(404);
  });

  test('el login rechaza una contraseña incorrecta sin decir si el correo existe', async () => {
    const mal = await request(app).post('/api/login').send({ email: 'admin@prueba.co', password: 'otra-clave' });
    const noExiste = await request(app).post('/api/login').send({ email: 'nadie@prueba.co', password: 'otra-clave' });
    expect(mal.status).toBe(401);
    expect(mal.body.error).toBe(noExiste.body.error);
  });
});
