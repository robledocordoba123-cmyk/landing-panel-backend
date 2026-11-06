const request = require('supertest');
const bcrypt = require('bcrypt');
const { app, prisma } = require('../app');
const { festivosDelAnio, esFestivo } = require('../citas/festivos');
const { fechaLocal, fechaValida, horariosPosibles, instante, jornadaDe, sumarDias, horaLegible } = require('../citas/horario');
const { cambiarEstado } = require('../citas/agenda');

const ADMIN = { email: 'agenda@huellitas.test', password: 'clave-de-pruebas' };

// Primer día hábil normal (ni domingo ni festivo) a partir de dentro de 3 días.
function diaHabil() {
  let fecha = sumarDias(fechaLocal(new Date()), 3);
  while (jornadaDe(fecha).abre !== 8 * 60) fecha = sumarDias(fecha, 1);
  return fecha;
}

const datos = (extra) => ({ nombre: 'Laura Gómez', email: 'laura@correo.com', telefono: '300 000 0001', mascota: 'Toby', especie: 'Perro', ...extra });

let consulta;
let vacuna;
let peluqueria;
let urgencias;
let token;

beforeAll(async () => {
  const servicios = await prisma.servicio.findMany();
  const por = (nombre) => servicios.find((s) => s.nombre === nombre);
  consulta = por('Consulta general');
  vacuna = por('Vacunación');
  peluqueria = por('Peluquería');
  urgencias = por('Urgencias');
  await prisma.usuario.deleteMany({ where: { email: ADMIN.email } });
  await prisma.usuario.create({ data: { email: ADMIN.email, password: await bcrypt.hash(ADMIN.password, 4) } });
  token = (await request(app).post('/api/login').send(ADMIN)).body.token;
});

const limpiar = async () => {
  await prisma.cita.deleteMany();
  await prisma.mascota.deleteMany();
  await prisma.cliente.deleteMany();
};

beforeEach(limpiar);

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

const reservar = (cuerpo) => request(app).post('/api/citas').send(cuerpo);
const libres = async (servicioId, fecha) => (await request(app).get('/api/disponibilidad').query({ servicioId, fecha })).body.horarios;
const autorizado = (r) => r.set('Authorization', `Bearer ${token}`);

describe('Festivos de Colombia', () => {
  test('calcula los 18 festivos de 2026', () => {
    expect([...festivosDelAnio(2026)].sort()).toEqual([
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
      '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
      '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
    ]);
  });

  test('un día corriente no es festivo', () => {
    expect(esFestivo('2026-11-05')).toBe(false);
  });
});

describe('Horarios', () => {
  // Jueves 5 de noviembre de 2026, 7:00 a. m. en Colombia.
  const ahora = new Date('2026-11-05T07:00:00-05:00');
  const horas = (lista) => lista.map(horaLegible);

  test('entre semana va de 8 a. m. a 7 p. m. y la última cita termina al cerrar', () => {
    const h = horas(horariosPosibles('2026-11-06', 30, ahora));
    expect(h[0]).toBe('8:00 a. m.');
    expect(h.at(-1)).toBe('6:30 p. m.');
  });

  test('un servicio largo no empieza si no alcanza a terminar', () => {
    expect(horas(horariosPosibles('2026-11-06', 90, ahora)).at(-1)).toBe('5:30 p. m.');
  });

  test('domingos y festivos va de 9 a. m. a 2 p. m.', () => {
    expect(horas(horariosPosibles('2026-11-08', 30, ahora))[0]).toBe('9:00 a. m.'); // domingo
    expect(horas(horariosPosibles('2026-11-16', 30, ahora)).at(-1)).toBe('1:30 p. m.'); // festivo
  });

  test('hoy solo ofrece horarios con al menos una hora de anticipación', () => {
    expect(horas(horariosPosibles('2026-11-05', 30, ahora))[0]).toBe('8:00 a. m.');
    expect(horas(horariosPosibles('2026-11-05', 30, new Date('2026-11-05T15:10:00-05:00')))[0]).toBe('4:30 p. m.');
  });

  test('no ofrece el pasado ni más allá de 60 días', () => {
    expect(horariosPosibles('2026-11-04', 30, ahora)).toEqual([]);
    expect(horariosPosibles('2027-01-05', 30, ahora)).toEqual([]);
  });

  test('rechaza fechas que no existen', () => {
    expect(fechaValida('2026-02-31')).toBe(false);
    expect(fechaValida('06/11/2026')).toBe(false);
    expect(fechaValida('2026-02-28')).toBe(true);
  });
});

describe('Reservar una cita', () => {
  test('la cita queda pendiente, con fin según la duración, y el horario deja de estar libre', async () => {
    const fecha = diaHabil();
    const inicio = instante(fecha, 9 * 60).toISOString();
    expect((await libres(consulta.id, fecha)).map((h) => h.inicio)).toContain(inicio);

    const res = await reservar(datos({ servicioId: consulta.id, inicio }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ servicio: 'Consulta general', estado: 'PENDIENTE' });
    expect(new Date(res.body.fin).getTime() - new Date(inicio).getTime()).toBe(30 * 60 * 1000);
    expect((await libres(consulta.id, fecha)).map((h) => h.inicio)).not.toContain(inicio);
  });

  test('la disponibilidad no revela quién reservó', async () => {
    const fecha = diaHabil();
    await reservar(datos({ servicioId: consulta.id, inicio: instante(fecha, 9 * 60).toISOString() }));
    const res = await request(app).get('/api/disponibilidad').query({ servicioId: consulta.id, fecha });
    expect(JSON.stringify(res.body)).not.toMatch(/laura/i);
  });

  test('dos servicios del consultorio no se cruzan, pero la peluquería sí puede a la misma hora', async () => {
    const fecha = diaHabil();
    const inicio = instante(fecha, 10 * 60).toISOString();
    expect((await reservar(datos({ servicioId: consulta.id, inicio }))).status).toBe(201);
    expect((await reservar(datos({ servicioId: vacuna.id, inicio, email: 'otra@correo.com' }))).status).toBe(409);
    expect((await reservar(datos({ servicioId: peluqueria.id, inicio, email: 'otra@correo.com' }))).status).toBe(201);
  });

  test('una cita larga bloquea los horarios que la pisan', async () => {
    const fecha = diaHabil();
    await reservar(datos({ servicioId: peluqueria.id, inicio: instante(fecha, 10 * 60).toISOString() })); // 10:00 a 11:30
    const horas = (await libres(peluqueria.id, fecha)).map((h) => h.hora);
    expect(horas).toContain('8:30 a. m.');
    expect(horas).not.toContain('9:00 a. m.');
    expect(horas).not.toContain('11:00 a. m.');
    expect(horas).toContain('11:30 a. m.');
  });

  test('si ocho personas reservan el mismo horario a la vez, solo una lo logra', async () => {
    const inicio = instante(diaHabil(), 11 * 60).toISOString();
    const respuestas = await Promise.all(
      Array.from({ length: 8 }, (_, i) => reservar(datos({ servicioId: consulta.id, inicio, email: `persona${i}@correo.com` }))),
    );
    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
    expect(respuestas.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await prisma.cita.count()).toBe(1);
  });

  test('rechaza horarios fuera de la jornada, fuera del paso de 30 minutos y urgencias', async () => {
    const fecha = diaHabil();
    expect((await reservar(datos({ servicioId: consulta.id, inicio: instante(fecha, 6 * 60).toISOString() }))).status).toBe(400);
    expect((await reservar(datos({ servicioId: consulta.id, inicio: instante(fecha, 9 * 60 + 10).toISOString() }))).status).toBe(400);
    expect((await reservar(datos({ servicioId: urgencias.id, inicio: instante(fecha, 9 * 60).toISOString() }))).status).toBe(400);
    expect((await request(app).get('/api/disponibilidad').query({ servicioId: urgencias.id, fecha })).status).toBe(404);
  });

  test('valida los datos de quien reserva', async () => {
    const base = { servicioId: consulta.id, inicio: instante(diaHabil(), 9 * 60).toISOString() };
    expect((await reservar(datos({ ...base, email: 'sin-arroba' }))).status).toBe(400);
    expect((await reservar(datos({ ...base, telefono: '' }))).status).toBe(400);
    expect((await reservar(datos({ ...base, mascota: '' }))).status).toBe(400);
    expect((await reservar(datos({ ...base, especie: 'Dragón' }))).status).toBe(400);
    expect((await reservar(datos({ ...base, inicio: 'mañana' }))).status).toBe(400);
  });

  test('un correo no puede tener más de 3 citas pendientes', async () => {
    const fecha = diaHabil();
    for (const m of [9, 10, 11]) {
      expect((await reservar(datos({ servicioId: consulta.id, inicio: instante(fecha, m * 60).toISOString() }))).status).toBe(201);
    }
    const res = await reservar(datos({ servicioId: consulta.id, inicio: instante(fecha, 12 * 60).toISOString() }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/3 citas/);
  });
});

describe('Agenda del panel', () => {
  const crear = async (hora = 9) => (await reservar(datos({ servicioId: consulta.id, inicio: instante(diaHabil(), hora * 60).toISOString() }))).body;
  const cambiar = (id, estado) => autorizado(request(app).patch(`/api/citas/${id}/estado`)).send({ estado });

  test('sin iniciar sesión no se ve ni se cambia nada', async () => {
    const { id } = await crear();
    expect((await request(app).get('/api/citas')).status).toBe(401);
    expect((await request(app).patch(`/api/citas/${id}/estado`).send({ estado: 'CONFIRMADA' })).status).toBe(401);
  });

  test('lista las citas del día con sus datos', async () => {
    const { id } = await crear();
    const res = await autorizado(request(app).get('/api/citas')).query({ desde: diaHabil() });
    expect(res.status).toBe(200);
    expect(res.body.citas.map((c) => c.id)).toEqual([id]);
    expect(res.body.citas[0]).toMatchObject({ mascota: { nombre: 'Toby', cliente: { nombre: 'Laura Gómez' } }, servicio: { nombre: 'Consulta general' } });
  });

  test('rechaza rangos de fechas inválidos', async () => {
    expect((await autorizado(request(app).get('/api/citas')).query({ desde: '2026-11-10', hasta: '2026-11-01' })).status).toBe(400);
    expect((await autorizado(request(app).get('/api/citas')).query({ desde: 'ayer' })).status).toBe(400);
  });

  test('confirma y cancela, y al cancelar se libera el horario', async () => {
    const fecha = diaHabil();
    const { id, inicio } = await crear();
    expect((await cambiar(id, 'CONFIRMADA')).body.estado).toBe('CONFIRMADA');
    expect((await libres(consulta.id, fecha)).map((h) => h.inicio)).not.toContain(inicio);
    expect((await cambiar(id, 'CANCELADA')).body.estado).toBe('CANCELADA');
    expect((await libres(consulta.id, fecha)).map((h) => new Date(h.inicio).toISOString())).toContain(new Date(inicio).toISOString());
  });

  test('no permite saltarse pasos ni revivir una cita cancelada', async () => {
    const { id } = await crear();
    expect((await cambiar(id, 'ATENDIDA')).status).toBe(409);
    await cambiar(id, 'CANCELADA');
    expect((await cambiar(id, 'CONFIRMADA')).status).toBe(409);
    expect((await cambiar(id, 'INVENTADO')).status).toBe(400);
    expect((await cambiar(999999, 'CONFIRMADA')).status).toBe(404);
  });

  test('una cita no se marca atendida ni como no asistió antes de su hora', async () => {
    const { id, inicio } = await crear();
    await cambiar(id, 'CONFIRMADA');
    expect((await cambiar(id, 'ATENDIDA')).status).toBe(409);
    expect((await cambiar(id, 'NO_ASISTIO')).status).toBe(409);
    const despues = new Date(new Date(inicio).getTime() + 60 * 1000);
    expect((await cambiarEstado(prisma, id, 'ATENDIDA', despues)).estado).toBe('ATENDIDA');
  });
});
