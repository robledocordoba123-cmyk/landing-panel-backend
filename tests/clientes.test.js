const request = require('supertest');
const { app, prisma } = require('../app');
const { sesionDe } = require('./ayuda');
const { leerMascota } = require('../clientes/mascotas');
const { vacunasPorVencer } = require('../clientes/ficha');
const { fechaLocal, instante, jornadaDe, sumarDias } = require('../citas/horario');

const ADMIN = { email: 'clientes@huellitas.test', rol: 'ADMIN' };

function diaHabil() {
  let fecha = sumarDias(fechaLocal(new Date()), 3);
  while (jornadaDe(fecha).abre !== 8 * 60) fecha = sumarDias(fecha, 1);
  return fecha;
}

let token;
let consulta;

const conToken = (r) => r.set('Cookie', token);
const reservar = (extra) => request(app).post('/api/citas').send({
  servicioId: consulta.id,
  inicio: instante(diaHabil(), 9 * 60).toISOString(),
  nombre: 'Laura Gómez',
  email: 'laura@correo.com',
  telefono: '300 000 0001',
  mascota: 'Toby',
  especie: 'Perro',
  autorizaDatos: true,
  ...extra,
});

const limpiar = async () => {
  await prisma.cita.deleteMany();
  await prisma.mascota.deleteMany();
  await prisma.cliente.deleteMany();
};

// Crea un cliente con una mascota y devuelve los dos.
async function clienteConMascota() {
  const cliente = await prisma.cliente.create({ data: { nombre: 'Ana', email: 'ana@correo.com', telefono: '300 111 2222', mascotas: { create: { nombre: 'Misha', especie: 'Gato' } } }, include: { mascotas: true } });
  return { cliente, mascota: cliente.mascotas[0] };
}

beforeAll(async () => {
  consulta = await prisma.servicio.findUnique({ where: { nombre: 'Consulta general' } });
  token = await sesionDe(prisma, ADMIN);
});

beforeEach(limpiar);

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

describe('Reservar crea o reutiliza al cliente y su mascota', () => {
  test('la primera reserva crea cliente y mascota', async () => {
    expect((await reservar()).status).toBe(201);
    const clientes = await prisma.cliente.findMany({ include: { mascotas: true } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ nombre: 'Laura Gómez', email: 'laura@correo.com' });
    expect(clientes[0].mascotas[0]).toMatchObject({ nombre: 'Toby', especie: 'Perro' });
  });

  test('el mismo correo y la misma mascota no duplican nada, aunque cambien las mayúsculas', async () => {
    await reservar();
    await reservar({ mascota: 'TOBY', inicio: instante(diaHabil(), 10 * 60).toISOString() });
    expect(await prisma.cliente.count()).toBe(1);
    expect(await prisma.mascota.count()).toBe(1);
    expect(await prisma.cita.count()).toBe(2);
  });

  test('una mascota nueva se suma al cliente que ya existe', async () => {
    await reservar();
    await reservar({ mascota: 'Luna', especie: 'Gato', inicio: instante(diaHabil(), 10 * 60).toISOString() });
    expect(await prisma.cliente.count()).toBe(1);
    expect(await prisma.mascota.count()).toBe(2);
  });

  test('reservar es público: no cambia los datos de un cliente que ya existe', async () => {
    await reservar();
    await reservar({ nombre: 'Impostor', telefono: '300 999 9999', inicio: instante(diaHabil(), 10 * 60).toISOString() });
    const cliente = await prisma.cliente.findUnique({ where: { email: 'laura@correo.com' } });
    expect(cliente).toMatchObject({ nombre: 'Laura Gómez', telefono: '300 000 0001' });
  });

  test('si el horario ya estaba tomado, no queda un cliente suelto', async () => {
    await reservar();
    expect((await reservar({ email: 'otra@correo.com' })).status).toBe(409);
    expect(await prisma.cliente.count()).toBe(1);
  });

  test.each([
    ['Toby, perro', 'Toby', 'Perro'],
    ['Misha (gata)', 'Misha', 'Gato'],
    ['Kiwi, loro', 'Kiwi', 'Ave'],
    ['Copito, conejo', 'Copito', 'Conejo'],
    ['Nemo', 'Nemo', 'Otro'],
  ])('entiende "%s" del chat', (texto, nombre, especie) => {
    expect(leerMascota(texto)).toEqual({ nombre, especie });
  });
});

describe('Clientes y mascotas en el panel', () => {
  test('todo exige iniciar sesión', async () => {
    const { cliente, mascota } = await clienteConMascota();
    expect((await request(app).get('/api/clientes')).status).toBe(401);
    expect((await request(app).get(`/api/clientes/${cliente.id}`)).status).toBe(401);
    expect((await request(app).get(`/api/mascotas/${mascota.id}`)).status).toBe(401);
    expect((await request(app).post(`/api/mascotas/${mascota.id}/vacunas`).send({})).status).toBe(401);
    expect((await request(app).get('/api/vacunas/por-vencer')).status).toBe(401);
  });

  test('las rutas públicas siguen funcionando sin sesión', async () => {
    expect((await request(app).get('/api/servicios')).status).toBe(200);
    expect((await request(app).post('/api/login').send({ email: 'x@y.co', password: 'nada' })).status).toBe(401);
  });

  test('busca por nombre, teléfono, correo o mascota', async () => {
    await clienteConMascota();
    await prisma.cliente.create({ data: { nombre: 'Pedro', email: 'pedro@correo.com' } });
    const buscar = async (q) => (await conToken(request(app).get('/api/clientes')).query({ q })).body.map((c) => c.nombre);
    expect(await buscar('')).toEqual(['Ana', 'Pedro']);
    expect(await buscar('misha')).toEqual(['Ana']);
    expect(await buscar('111 2222')).toEqual(['Ana']);
    expect(await buscar('PEDRO@')).toEqual(['Pedro']);
    expect(await buscar('nadie')).toEqual([]);
  });

  test('corrige los datos de un cliente y rechaza un correo repetido', async () => {
    const { cliente } = await clienteConMascota();
    await prisma.cliente.create({ data: { nombre: 'Pedro', email: 'pedro@correo.com' } });
    const editar = (datos) => conToken(request(app).patch(`/api/clientes/${cliente.id}`)).send(datos);
    expect((await editar({ nombre: 'Ana María', email: 'ana@correo.com', telefono: '300 555 6666' })).body.nombre).toBe('Ana María');
    expect((await editar({ nombre: 'Ana', email: 'pedro@correo.com' })).status).toBe(409);
    expect((await editar({ nombre: 'A', email: 'ana@correo.com' })).status).toBe(400);
  });

  test('agrega y edita mascotas con validación', async () => {
    const { cliente, mascota } = await clienteConMascota();
    const nueva = await conToken(request(app).post(`/api/clientes/${cliente.id}/mascotas`)).send({ nombre: 'Rocky', especie: 'Perro', sexo: 'Macho', fechaNacimiento: '2022-03-01' });
    expect(nueva.status).toBe(201);
    expect((await conToken(request(app).post(`/api/clientes/${cliente.id}/mascotas`)).send({ nombre: 'X', especie: 'Dragón' })).status).toBe(400);
    expect((await conToken(request(app).post('/api/clientes/999999/mascotas')).send({ nombre: 'X', especie: 'Gato' })).status).toBe(404);
    const editar = (datos) => conToken(request(app).patch(`/api/mascotas/${mascota.id}`)).send(datos);
    expect((await editar({ nombre: 'Misha', especie: 'Gato', raza: 'Siamés' })).body.raza).toBe('Siamés');
    expect((await editar({ nombre: 'Misha', especie: 'Gato', fechaNacimiento: '2999-01-01' })).status).toBe(400);
  });
});

describe('Historia clínica', () => {
  const atender = (mascotaId, datos) => conToken(request(app).post(`/api/mascotas/${mascotaId}/atenciones`)).send(datos);

  test('registra una atención con quién la hizo y sale en la ficha', async () => {
    const { mascota } = await clienteConMascota();
    const res = await atender(mascota.id, { motivo: 'Control anual', diagnostico: 'Sana', pesoKg: 4.2, temperaturaC: 38.5 });
    expect(res.status).toBe(201);
    expect(res.body.registradoPor).toBe(ADMIN.email);
    const ficha = await conToken(request(app).get(`/api/mascotas/${mascota.id}`));
    expect(ficha.body.atenciones[0]).toMatchObject({ motivo: 'Control anual', pesoKg: 4.2 });
    expect(ficha.body.cliente.nombre).toBe('Ana');
  });

  test('valida el motivo, el peso y la temperatura', async () => {
    const { mascota } = await clienteConMascota();
    expect((await atender(mascota.id, { motivo: '' })).status).toBe(400);
    expect((await atender(mascota.id, { motivo: 'Control', pesoKg: -1 })).status).toBe(400);
    expect((await atender(mascota.id, { motivo: 'Control', temperaturaC: 99 })).status).toBe(400);
    expect((await atender(999999, { motivo: 'Control' })).status).toBe(404);
  });

  // Cita ya empezada y confirmada, creada directo porque la API no reserva el pasado.
  async function citaEmpezada(mascotaId, estado = 'CONFIRMADA', minutosAtras = 10) {
    const inicio = new Date(Date.now() - minutosAtras * 60 * 1000);
    return prisma.cita.create({ data: { servicioId: consulta.id, recurso: consulta.recurso, inicio, fin: new Date(inicio.getTime() + 30 * 60 * 1000), mascotaId, estado } });
  }

  test('atender una cita la marca ATENDIDA y queda ligada, una sola vez', async () => {
    const { mascota } = await clienteConMascota();
    const cita = await citaEmpezada(mascota.id);
    expect((await atender(mascota.id, { motivo: 'Consulta', citaId: cita.id })).status).toBe(201);
    expect((await prisma.cita.findUnique({ where: { id: cita.id } })).estado).toBe('ATENDIDA');
    expect((await atender(mascota.id, { motivo: 'Otra vez', citaId: cita.id })).status).toBe(409);
    expect(await prisma.atencion.count({ where: { citaId: cita.id } })).toBe(1);
  });

  test('no se atiende una cita pendiente, ni la de otra mascota, y entonces no se guarda nada', async () => {
    const { cliente, mascota } = await clienteConMascota();
    const otra = await prisma.mascota.create({ data: { clienteId: cliente.id, nombre: 'Rex', especie: 'Perro' } });
    const pendiente = await citaEmpezada(mascota.id, 'PENDIENTE');
    expect((await atender(mascota.id, { motivo: 'Consulta', citaId: pendiente.id })).status).toBe(409);
    const ajena = await citaEmpezada(otra.id, 'CONFIRMADA', 60);
    expect((await atender(mascota.id, { motivo: 'Consulta', citaId: ajena.id })).status).toBe(409);
    expect(await prisma.atencion.count()).toBe(0);
  });
});

describe('Carné de vacunas', () => {
  const hoy = fechaLocal(new Date());
  const vacunar = (mascotaId, datos) => conToken(request(app).post(`/api/mascotas/${mascotaId}/vacunas`)).send(datos);

  test('registra una vacuna y valida las fechas', async () => {
    const { mascota } = await clienteConMascota();
    expect((await vacunar(mascota.id, { nombre: 'Rabia', aplicadaEn: hoy, proximaDosis: sumarDias(hoy, 365), lote: 'A1' })).status).toBe(201);
    expect((await vacunar(mascota.id, { nombre: 'Rabia', aplicadaEn: sumarDias(hoy, 1) })).status).toBe(400);
    expect((await vacunar(mascota.id, { nombre: 'Rabia', aplicadaEn: hoy, proximaDosis: hoy })).status).toBe(400);
    expect((await vacunar(mascota.id, { nombre: '', aplicadaEn: hoy })).status).toBe(400);
    const ficha = await conToken(request(app).get(`/api/mascotas/${mascota.id}`));
    expect(ficha.body.vacunas).toHaveLength(1);
  });

  test('avisa las vacunas vencidas y las que vencen en 30 días, pero no las lejanas', async () => {
    const { mascota } = await clienteConMascota();
    await vacunar(mascota.id, { nombre: 'Vencida', aplicadaEn: sumarDias(hoy, -400), proximaDosis: sumarDias(hoy, -5) });
    await vacunar(mascota.id, { nombre: 'Pronto', aplicadaEn: sumarDias(hoy, -300), proximaDosis: sumarDias(hoy, 20) });
    await vacunar(mascota.id, { nombre: 'Lejana', aplicadaEn: sumarDias(hoy, -10), proximaDosis: sumarDias(hoy, 200) });
    const res = await conToken(request(app).get('/api/vacunas/por-vencer'));
    expect(res.body.map((v) => v.nombre)).toEqual(['Vencida', 'Pronto']);
    expect(res.body[0].mascota.cliente.nombre).toBe('Ana');
  });

  test('al aplicar la dosis nueva, la vencida deja de avisar', async () => {
    const { mascota } = await clienteConMascota();
    await vacunar(mascota.id, { nombre: 'Rabia', aplicadaEn: sumarDias(hoy, -400), proximaDosis: sumarDias(hoy, -5) });
    expect(await vacunasPorVencer(prisma, 30)).toHaveLength(1);
    await vacunar(mascota.id, { nombre: 'RABIA', aplicadaEn: hoy, proximaDosis: sumarDias(hoy, 365) });
    expect(await vacunasPorVencer(prisma, 30)).toHaveLength(0);
  });

  test('una vacuna mal registrada se puede borrar', async () => {
    const { mascota } = await clienteConMascota();
    const { body } = await vacunar(mascota.id, { nombre: 'Rabia', aplicadaEn: hoy });
    expect((await conToken(request(app).delete(`/api/vacunas/${body.id}`))).status).toBe(204);
    expect((await conToken(request(app).delete(`/api/vacunas/${body.id}`))).status).toBe(404);
  });
});
