const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app, prisma } = require('../app');
const { sesionDe } = require('./ayuda');
const { fechaLocal, instante, jornadaDe, sumarDias } = require('../citas/horario');

const CLAVE = 'clave-de-pruebas-123';

function diaHabil() {
  let fecha = sumarDias(fechaLocal(new Date()), 3);
  while (jornadaDe(fecha).abre !== 8 * 60) fecha = sumarDias(fecha, 1);
  return fecha;
}

let admin;
let veterinario;
let recepcion;

const como = (cookie, r) => r.set('Cookie', cookie);
const limpiar = async () => {
  await prisma.cita.deleteMany();
  await prisma.mascota.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.mensaje.deleteMany();
};

async function clienteConMascota() {
  const cliente = await prisma.cliente.create({ data: { nombre: 'Ana', email: 'ana@correo.com', telefono: '300 111 2222', mascotas: { create: { nombre: 'Misha', especie: 'Gato' } } }, include: { mascotas: true } });
  return { cliente, mascota: cliente.mascotas[0] };
}

beforeEach(async () => {
  await limpiar();
  await prisma.usuario.deleteMany();
  admin = await sesionDe(prisma, { email: 'admin@huellitas.test', rol: 'ADMIN' });
  veterinario = await sesionDe(prisma, { email: 'vet@huellitas.test', rol: 'VETERINARIO' });
  recepcion = await sesionDe(prisma, { email: 'recep@huellitas.test', rol: 'RECEPCION' });
});

afterEach(() => {
  delete process.env.MODO_DEMO;
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

describe('Sesión', () => {
  test('la cookie es httpOnly y strict, y el token nunca va en el cuerpo', async () => {
    const res = await request(app).post('/api/login').send({ email: 'admin@huellitas.test', password: CLAVE });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(res.body).toEqual(expect.objectContaining({ email: 'admin@huellitas.test', rol: 'ADMIN' }));
    expect(res.body.token).toBeUndefined();
    expect(res.body.password).toBeUndefined();
  });

  test('sin cookie no entra, y un encabezado Bearer ya no sirve', async () => {
    expect((await request(app).get('/api/sesion')).status).toBe(401);
    const token = jwt.sign({ id: 1, v: 0 }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/sesion').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('un token firmado con otra clave no sirve', async () => {
    const falso = jwt.sign({ id: 1, v: 0 }, 'otra-clave');
    expect((await request(app).get('/api/sesion').set('Cookie', `huellitas_sesion=${falso}`)).status).toBe(401);
  });

  test('cerrar sesión borra la cookie', async () => {
    const res = await como(admin, request(app).post('/api/logout'));
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/huellitas_sesion=;/);
  });

  test('desactivar una cuenta la saca de inmediato', async () => {
    const vet = await prisma.usuario.findUnique({ where: { email: 'vet@huellitas.test' } });
    expect((await como(veterinario, request(app).get('/api/sesion'))).status).toBe(200);
    await como(admin, request(app).patch(`/api/usuarios/${vet.id}`)).send({ nombre: 'Vet', rol: 'VETERINARIO', activo: false });
    expect((await como(veterinario, request(app).get('/api/sesion'))).status).toBe(401);
    expect((await request(app).post('/api/login').send({ email: 'vet@huellitas.test', password: CLAVE })).status).toBe(401);
  });

  test('cambiar la clave exige la actual y cierra las otras sesiones', async () => {
    const cambiar = (datos) => como(recepcion, request(app).post('/api/sesion/clave')).send(datos);
    expect((await cambiar({ actual: 'mala', nueva: 'clave-nueva-larga-1' })).status).toBe(400);
    expect((await cambiar({ actual: CLAVE, nueva: 'corta' })).status).toBe(400);
    expect((await cambiar({ actual: CLAVE, nueva: 'clave-nueva-larga-1' })).status).toBe(204);
    expect((await como(recepcion, request(app).get('/api/sesion'))).status).toBe(401);
    expect((await request(app).post('/api/login').send({ email: 'recep@huellitas.test', password: 'clave-nueva-larga-1' })).status).toBe(200);
  });
});

describe('Roles', () => {
  test('recepción ve la ficha sin historia clínica; veterinario y administración sí', async () => {
    const { mascota } = await clienteConMascota();
    await prisma.atencion.create({ data: { mascotaId: mascota.id, motivo: 'Control', diagnostico: 'Secreto médico', registradoPor: 'x' } });
    const ficha = (cookie) => como(cookie, request(app).get(`/api/mascotas/${mascota.id}`));
    const deRecepcion = await ficha(recepcion);
    expect(deRecepcion.status).toBe(200);
    expect(deRecepcion.body.nombre).toBe('Misha');
    expect(deRecepcion.body.atenciones).toBeUndefined();
    expect(JSON.stringify(deRecepcion.body)).not.toMatch(/Secreto/);
    expect((await ficha(veterinario)).body.atenciones).toHaveLength(1);
    expect((await ficha(admin)).body.atenciones).toHaveLength(1);
  });

  test('recepción no registra atenciones ni vacunas', async () => {
    const { mascota } = await clienteConMascota();
    expect((await como(recepcion, request(app).post(`/api/mascotas/${mascota.id}/atenciones`)).send({ motivo: 'Control' })).status).toBe(403);
    expect((await como(recepcion, request(app).post(`/api/mascotas/${mascota.id}/vacunas`)).send({ nombre: 'Rabia', aplicadaEn: fechaLocal(new Date()) })).status).toBe(403);
    expect((await como(veterinario, request(app).post(`/api/mascotas/${mascota.id}/atenciones`)).send({ motivo: 'Control' })).status).toBe(201);
  });

  test('veterinario no corrige datos de contacto ni ve los correos', async () => {
    const { cliente } = await clienteConMascota();
    expect((await como(veterinario, request(app).patch(`/api/clientes/${cliente.id}`)).send({ nombre: 'Ana', email: 'ana@correo.com' })).status).toBe(403);
    expect((await como(veterinario, request(app).get('/api/notificaciones'))).status).toBe(403);
    expect((await como(recepcion, request(app).patch(`/api/clientes/${cliente.id}`)).send({ nombre: 'Ana María', email: 'ana@correo.com' })).status).toBe(200);
  });

  test('solo administración ve el equipo y la bitácora', async () => {
    for (const ruta of ['/api/usuarios', '/api/bitacora']) {
      expect((await como(recepcion, request(app).get(ruta))).status).toBe(403);
      expect((await como(veterinario, request(app).get(ruta))).status).toBe(403);
      expect((await como(admin, request(app).get(ruta))).status).toBe(200);
    }
  });
});

describe('Equipo', () => {
  const crear = (cookie, datos) => como(cookie, request(app).post('/api/usuarios')).send(datos);

  test('crea cuentas con clave larga, sin devolverla, y no repite correos', async () => {
    const datos = { nombre: 'Nueva', email: 'Nueva@Huellitas.test', rol: 'RECEPCION', password: 'una-clave-bien-larga' };
    const res = await crear(admin, datos);
    expect(res.status).toBe(201);
    expect(res.body.password).toBeUndefined();
    expect(res.body.email).toBe('nueva@huellitas.test');
    expect((await crear(admin, datos)).status).toBe(409);
    expect((await crear(admin, { ...datos, email: 'otra@x.co', password: 'corta' })).status).toBe(400);
    expect((await crear(admin, { ...datos, email: 'otra@x.co', rol: 'DIOS' })).status).toBe(400);
  });

  test('nunca queda el negocio sin administración', async () => {
    const yo = await prisma.usuario.findUnique({ where: { email: 'admin@huellitas.test' } });
    const editar = (datos) => como(admin, request(app).patch(`/api/usuarios/${yo.id}`)).send({ nombre: 'Admin', ...datos });
    expect((await editar({ rol: 'ADMIN', activo: false })).status).toBe(409);
    expect((await editar({ rol: 'RECEPCION', activo: true })).status).toBe(409);
    expect((await prisma.usuario.findUnique({ where: { id: yo.id } })).rol).toBe('ADMIN');
  });

  test('cambiar el rol aplica de inmediato', async () => {
    const vet = await prisma.usuario.findUnique({ where: { email: 'vet@huellitas.test' } });
    await como(admin, request(app).patch(`/api/usuarios/${vet.id}`)).send({ nombre: 'Vet', rol: 'RECEPCION', activo: true });
    expect((await como(veterinario, request(app).get('/api/sesion'))).status).toBe(401);
  });

  test('en la demo pública no se pueden tocar las cuentas ni las claves', async () => {
    process.env.MODO_DEMO = 'true';
    expect((await crear(admin, { nombre: 'X', email: 'x@x.co', rol: 'ADMIN', password: 'una-clave-bien-larga' })).status).toBe(403);
    expect((await como(admin, request(app).post('/api/sesion/clave')).send({ actual: CLAVE, nueva: 'clave-nueva-larga-1' })).status).toBe(403);
  });
});

describe('Bitácora', () => {
  test('registra entradas, intentos fallidos y lectura de historias, sin datos clínicos', async () => {
    await request(app).post('/api/login').send({ email: 'admin@huellitas.test', password: 'mala' });
    const { mascota } = await clienteConMascota();
    await como(veterinario, request(app).post(`/api/mascotas/${mascota.id}/atenciones`)).send({ motivo: 'Control', diagnostico: 'Secreto médico' });
    await como(veterinario, request(app).get(`/api/mascotas/${mascota.id}`));
    const { body } = await como(admin, request(app).get('/api/bitacora'));
    const acciones = body.registros.map((r) => r.accion);
    expect(acciones).toEqual(expect.arrayContaining(['LOGIN', 'LOGIN_FALLIDO', 'HISTORIA_ESCRITA', 'HISTORIA_VISTA']));
    expect(JSON.stringify(body)).not.toMatch(/Secreto|mala/);
  });

  test('recepción abriendo una ficha sin historia no cuenta como lectura clínica', async () => {
    const { mascota } = await clienteConMascota();
    const antes = await prisma.bitacora.count({ where: { accion: 'HISTORIA_VISTA' } });
    await como(recepcion, request(app).get(`/api/mascotas/${mascota.id}`));
    expect(await prisma.bitacora.count({ where: { accion: 'HISTORIA_VISTA' } })).toBe(antes);
  });

  test('ni la propia aplicación puede cambiarla o borrarla', async () => {
    const fila = await prisma.bitacora.findFirst();
    await expect(prisma.bitacora.update({ where: { id: fila.id }, data: { accion: 'OTRA' } })).rejects.toThrow();
    await expect(prisma.bitacora.delete({ where: { id: fila.id } })).rejects.toThrow();
  });
});

describe('Datos personales (Ley 1581)', () => {
  const reserva = (extra) => ({
    servicioId: 1,
    inicio: instante(diaHabil(), 9 * 60).toISOString(),
    nombre: 'Laura',
    email: 'laura@correo.com',
    telefono: '300 000 0001',
    mascota: 'Toby',
    especie: 'Perro',
    ...extra,
  });

  test('no se reserva sin autorización, y al darla queda la prueba', async () => {
    const consulta = await prisma.servicio.findUnique({ where: { nombre: 'Consulta general' } });
    expect((await request(app).post('/api/citas').send(reserva({ servicioId: consulta.id }))).status).toBe(400);
    expect(await prisma.cliente.count()).toBe(0);
    expect((await request(app).post('/api/citas').send(reserva({ servicioId: consulta.id, autorizaDatos: true }))).status).toBe(201);
    const [autorizacion] = await prisma.autorizacionDatos.findMany({ include: { cliente: true } });
    expect(autorizacion).toMatchObject({ canal: 'WEB', cliente: { email: 'laura@correo.com' } });
    expect(autorizacion.version).toBeTruthy();
  });

  test('el formulario de preguntas también pide autorización', async () => {
    const datos = { nombre: 'Ana', email: 'ana@correo.com', mensaje: 'Una pregunta larga' };
    expect((await request(app).post('/api/mensajes').send(datos)).status).toBe(400);
    expect((await request(app).post('/api/mensajes').send({ ...datos, autorizaDatos: true })).status).toBe(201);
    expect((await prisma.mensaje.findFirst()).autorizaDatosEn).not.toBeNull();
  });

  test('suprimir borra los datos personales, cancela lo futuro y conserva la historia', async () => {
    const { cliente, mascota } = await clienteConMascota();
    const consulta = await prisma.servicio.findUnique({ where: { nombre: 'Consulta general' } });
    const inicio = instante(diaHabil(), 9 * 60);
    const cita = await prisma.cita.create({ data: { servicioId: consulta.id, recurso: consulta.recurso, inicio, fin: new Date(inicio.getTime() + 1800000), mascotaId: mascota.id } });
    await prisma.atencion.create({ data: { mascotaId: mascota.id, motivo: 'Control', registradoPor: 'x' } });
    await prisma.mensaje.create({ data: { nombre: 'Ana', email: 'ana@correo.com', mensaje: 'hola' } });

    expect((await como(recepcion, request(app).post(`/api/clientes/${cliente.id}/suprimir`))).status).toBe(403);
    expect((await como(admin, request(app).post(`/api/clientes/${cliente.id}/suprimir`))).status).toBe(200);

    const despues = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    expect(despues.nombre).toBe('Datos suprimidos');
    expect(despues.telefono).toBeNull();
    expect(despues.email).not.toMatch(/ana@/);
    expect(despues.anonimizadoEn).not.toBeNull();
    expect((await prisma.cita.findUnique({ where: { id: cita.id } })).estado).toBe('CANCELADA');
    expect(await prisma.atencion.count({ where: { mascotaId: mascota.id } })).toBe(1);
    expect(await prisma.mensaje.count({ where: { email: 'ana@correo.com' } })).toBe(0);
    expect((await como(admin, request(app).post(`/api/clientes/${cliente.id}/suprimir`))).status).toBe(409);
  });
});
