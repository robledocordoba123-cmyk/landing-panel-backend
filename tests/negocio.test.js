const request = require('supertest');
const { app, prisma } = require('../app');
const { sesionDe } = require('./ayuda');
const { olvidarCalendario } = require('../citas/calendario');
const { CALENDARIO_POR_DEFECTO, FESTIVOS, diaSemana, fechaLocal, instante, jornadaDe, lineasHorario, sumarDias } = require('../citas/horario');

const POR_DEFECTO = [0, 1, 2, 3, 4, 5, 6, FESTIVOS].map((dia) => ({ dia, ...CALENDARIO_POR_DEFECTO.jornadas.get(dia) }));
const conDia = (dia, cambios) => POR_DEFECTO.map((j) => (j.dia === dia ? { ...j, ...cambios } : j));

// Primer día normal (ni domingo, ni sábado, ni festivo) desde dentro de 3 días.
function diaHabil() {
  let fecha = sumarDias(fechaLocal(new Date()), 3);
  while (jornadaDe(fecha).abre !== 8 * 60 || diaSemana(fecha) === 6) fecha = sumarDias(fecha, 1);
  return fecha;
}
function proximoSabado() {
  let fecha = sumarDias(fechaLocal(new Date()), 3);
  while (diaSemana(fecha) !== 6 || jornadaDe(fecha).abre !== 8 * 60) fecha = sumarDias(fecha, 1);
  return fecha;
}

let admin;
let recepcion;
let consulta;
let serviciosOriginales;
const como = (cookie, peticion) => peticion.set('Cookie', cookie);
const horas = async (servicioId, fecha) => (await request(app).get('/api/disponibilidad').query({ servicioId, fecha })).body;
const reservar = (servicio, inicio, email = 'negocio@correo.com') => request(app).post('/api/citas').send({
  nombre: 'Ana Negocio', email, telefono: '300 111 2222', mascota: 'Lola', especie: 'Gato', autorizaDatos: true, servicioId: servicio.id, inicio,
});

async function restaurar() {
  await prisma.cita.deleteMany();
  await prisma.cierre.deleteMany();
  await prisma.$transaction(POR_DEFECTO.map(({ dia, abierto, abre, cierra }) => prisma.jornada.update({ where: { dia }, data: { abierto, abre, cierra } })));
  olvidarCalendario();
}

beforeAll(async () => {
  await restaurar();
  serviciosOriginales = await prisma.servicio.findMany();
  consulta = serviciosOriginales.find((s) => s.nombre === 'Consulta general');
  admin = await sesionDe(prisma, { email: 'negocio-admin@prueba.com', rol: 'ADMIN' });
  recepcion = await sesionDe(prisma, { email: 'negocio-recepcion@prueba.com', rol: 'RECEPCION' });
});

afterAll(async () => {
  await restaurar();
  await prisma.servicio.deleteMany({ where: { id: { notIn: serviciosOriginales.map((s) => s.id) } } });
  for (const { id, nombre, detalle, precioDesde, duracionMin, recurso, reservable, activo } of serviciosOriginales) {
    await prisma.servicio.update({ where: { id }, data: { nombre, detalle, precioDesde, duracionMin, recurso, reservable, activo } });
  }
  await prisma.$disconnect();
});

describe('horario en frases', () => {
  const calendario = (jornadas) => ({ jornadas: new Map(jornadas.map((j) => [j.dia, j])), cierres: new Map() });

  test('junta los días que abren igual', () => {
    expect(lineasHorario(calendario(POR_DEFECTO))).toEqual(['Lunes a sábado: 8:00 a. m. – 7:00 p. m.', 'Domingos y festivos: 9:00 a. m. – 2:00 p. m.']);
  });

  test('separa el sábado, los festivos y los días cerrados', () => {
    const jornadas = conDia(6, { abre: 480, cierra: 780 }).map((j) => (j.dia === 0 ? { ...j, abierto: false } : j));
    expect(lineasHorario(calendario(jornadas))).toEqual([
      'Lunes a viernes: 8:00 a. m. – 7:00 p. m.',
      'Sábado: 8:00 a. m. – 1:00 p. m.',
      'Domingos: cerrado',
      'Festivos: 9:00 a. m. – 2:00 p. m.',
    ]);
  });
});

describe('horario editable', () => {
  afterEach(restaurar);

  test('cualquiera lo puede leer; solo administración lo cambia', async () => {
    const { body } = await request(app).get('/api/horario');
    expect(body.lineas).toContain('Lunes a sábado: 8:00 a. m. – 7:00 p. m.');
    expect(body.jornadas).toHaveLength(8);
    expect((await request(app).put('/api/horario').send({ jornadas: POR_DEFECTO })).status).toBe(401);
    expect((await como(recepcion, request(app).put('/api/horario')).send({ jornadas: POR_DEFECTO })).status).toBe(403);
  });

  test('rechaza horas imposibles o fuera de bloques de 30 minutos', async () => {
    const enviar = (jornadas) => como(admin, request(app).put('/api/horario')).send({ jornadas });
    expect((await enviar(conDia(1, { abre: 600, cierra: 540 }))).status).toBe(400);
    expect((await enviar(conDia(1, { abre: 485 }))).status).toBe(400);
    expect((await enviar(POR_DEFECTO.slice(1))).status).toBe(400);
  });

  test('un cambio se aplica de una vez a la página, la reserva y el asistente', async () => {
    const sabado = proximoSabado();
    const res = await como(admin, request(app).put('/api/horario')).send({ jornadas: conDia(6, { cierra: 780 }) });
    expect(res.status).toBe(200);
    expect(res.body.lineas).toContain('Sábado: 8:00 a. m. – 1:00 p. m.');
    const libres = (await horas(consulta.id, sabado)).horarios.map((h) => h.hora);
    expect(libres.at(-1)).toBe('12:30 p. m.');
    expect((await reservar(consulta, instante(sabado, 14 * 60).toISOString())).status).toBe(400);
  });

  test('no deja por fuera citas ya reservadas', async () => {
    const fecha = diaHabil();
    const cita = await reservar(consulta, instante(fecha, 17 * 60).toISOString());
    expect(cita.status).toBe(201);
    const res = await como(admin, request(app).put('/api/horario')).send({ jornadas: conDia(diaSemana(fecha), { cierra: 16 * 60 }) });
    expect(res.status).toBe(409);
    expect(res.body.conflictos).toEqual([expect.objectContaining({ id: cita.body.id, mascota: 'Lola' })]);
    expect((await prisma.jornada.findUnique({ where: { dia: diaSemana(fecha) } })).cierra).toBe(19 * 60);
  });
});

describe('días cerrados', () => {
  afterEach(restaurar);
  const cerrar = (fecha, motivo = 'Vacaciones del equipo') => como(admin, request(app).post('/api/cierres')).send({ fecha, motivo });

  test('un día cerrado no ofrece horarios, dice por qué y no recibe reservas', async () => {
    const fecha = diaHabil();
    expect((await cerrar(fecha)).status).toBe(201);
    const dia = await horas(consulta.id, fecha);
    expect(dia).toMatchObject({ horarios: [], cerrado: 'Vacaciones del equipo', jornada: null });
    expect((await reservar(consulta, instante(fecha, 9 * 60).toISOString())).status).toBe(400);
    expect((await request(app).get('/api/horario')).body.cierres).toEqual([{ fecha, motivo: 'Vacaciones del equipo' }]);

    expect((await como(admin, request(app).delete(`/api/cierres/${fecha}`))).status).toBe(200);
    expect((await horas(consulta.id, fecha)).horarios.length).toBeGreaterThan(0);
  });

  test('no cierra un día con citas, ni uno pasado, ni dos veces', async () => {
    const fecha = diaHabil();
    await reservar(consulta, instante(fecha, 10 * 60).toISOString());
    expect((await cerrar(fecha)).status).toBe(409);
    expect((await cerrar(sumarDias(fechaLocal(new Date()), -1))).status).toBe(400);
    const otro = sumarDias(fecha, 1);
    expect((await cerrar(otro)).status).toBe(201);
    expect((await cerrar(otro)).status).toBe(409);
    expect((await cerrar(sumarDias(otro, 1), 'x')).status).toBe(400);
  });
});

describe('servicios editables', () => {
  const datos = (cambios) => ({ ...consulta, ...cambios });
  const editar = (id, cuerpo, cookie = admin) => como(cookie, request(app).patch(`/api/servicios/${id}`)).send(cuerpo);

  test('administración cambia el precio y la página lo ve', async () => {
    expect((await editar(consulta.id, datos({ precioDesde: 65000 }), recepcion)).status).toBe(403);
    expect((await editar(consulta.id, datos({ precioDesde: 65000 }))).status).toBe(200);
    const publicos = (await request(app).get('/api/servicios')).body;
    expect(publicos.find((s) => s.id === consulta.id).precioDesde).toBe(65000);
  });

  test('valida duración, precio y lugar', async () => {
    expect((await editar(consulta.id, datos({ duracionMin: 20 }))).status).toBe(400);
    expect((await editar(consulta.id, datos({ precioDesde: -1 }))).status).toBe(400);
    expect((await editar(consulta.id, datos({ recurso: 'PATIO' }))).status).toBe(400);
    expect((await editar(999999, datos({}))).status).toBe(404);
  });

  test('un servicio inactivo desaparece de la página y no se reserva, pero sigue en el panel', async () => {
    await editar(consulta.id, datos({ activo: false }));
    expect((await request(app).get('/api/servicios')).body.map((s) => s.id)).not.toContain(consulta.id);
    expect((await request(app).get('/api/disponibilidad').query({ servicioId: consulta.id, fecha: diaHabil() })).status).toBe(404);
    expect((await reservar(consulta, instante(diaHabil(), 9 * 60).toISOString())).status).toBe(400);
    const todos = (await como(admin, request(app).get('/api/servicios/todos'))).body;
    expect(todos.find((s) => s.id === consulta.id)).toMatchObject({ activo: false });
    await editar(consulta.id, datos({ activo: true }));
  });

  test('un servicio nuevo se puede reservar con su propia duración', async () => {
    const nuevo = await como(admin, request(app).post('/api/servicios')).send({
      nombre: 'Control de peso', detalle: 'pesaje y plan de alimentación', precioDesde: 35000, duracionMin: 45, recurso: 'CONSULTORIO', reservable: true, activo: true,
    });
    expect(nuevo.status).toBe(201);
    const libres = (await horas(nuevo.body.id, diaHabil())).horarios.map((h) => h.hora);
    expect(libres.at(-1)).toBe('6:00 p. m.'); // 6:00 + 45 min termina antes de las 7:00
    expect((await como(admin, request(app).post('/api/servicios')).send(nuevo.body)).status).toBe(409);
  });
});

describe('reportes', () => {
  let mascota;
  let peluqueria;
  const crear = (dia, hora, estado, servicio, origen = 'WEB') => prisma.cita.create({
    data: { servicioId: servicio.id, recurso: servicio.recurso, inicio: instante(dia, hora * 60), fin: instante(dia, hora * 60 + servicio.duracionMin), estado, mascotaId: mascota.id, origen },
  });
  const pedir = (consulta_, cookie = admin) => como(cookie, request(app).get('/api/reportes')).query(consulta_);

  beforeAll(async () => {
    await prisma.cita.deleteMany();
    peluqueria = serviciosOriginales.find((s) => s.nombre === 'Peluquería');
    const cliente = await prisma.cliente.create({ data: { nombre: 'Reporte', email: 'reporte@correo.com', creadoEn: new Date('2026-01-03T15:00:00Z') } });
    mascota = await prisma.mascota.create({ data: { nombre: 'Kiwi', especie: 'Ave', clienteId: cliente.id } });
    await crear('2026-01-05', 9, 'ATENDIDA', consulta);
    await crear('2026-01-05', 10, 'ATENDIDA', peluqueria, 'WHATSAPP');
    await crear('2026-01-12', 9, 'NO_ASISTIO', consulta);
    await crear('2026-01-20', 9, 'CANCELADA', consulta);
    await crear('2025-12-10', 9, 'ATENDIDA', consulta);
  });

  test('solo para administración y con un periodo razonable', async () => {
    expect((await pedir({}, recepcion)).status).toBe(403);
    expect((await pedir({ desde: '2026-01-01', hasta: '2027-06-01' })).status).toBe(400);
    expect((await pedir({ desde: '2026-02-01', hasta: '2026-01-01' })).status).toBe(400);
  });

  test('cuenta citas, ingresos estimados, inasistencia y cancelación del periodo', async () => {
    const { body } = await pedir({ desde: '2026-01-01', hasta: '2026-01-31' });
    const precioConsulta = (await prisma.servicio.findUnique({ where: { id: consulta.id } })).precioDesde;
    expect(body).toMatchObject({
      citas: 3, atendidas: 2, ingresos: precioConsulta + peluqueria.precioDesde, clientesNuevos: 1,
      inasistencia: 0.333, cancelacion: 0.25, porOrigen: { WEB: 2, WHATSAPP: 1 },
    });
    expect(body.porServicio[0]).toMatchObject({ nombre: 'Consulta general', citas: 2, atendidas: 1 });
    expect(body.serie.unidad).toBe('dia');
    expect(body.serie.puntos).toHaveLength(31);
    expect(body.serie.puntos.find((p) => p.desde === '2026-01-05')).toMatchObject({ citas: 2, atendidas: 2 });
    expect(body.anterior).toMatchObject({ desde: '2025-12-01', hasta: '2025-12-31', atendidas: 1 });
  });

  test('con periodos largos agrupa por semana o por mes', async () => {
    const trimestre = (await pedir({ desde: '2026-01-01', hasta: '2026-03-31' })).body.serie;
    expect(trimestre.unidad).toBe('semana');
    expect(trimestre.puntos[0].desde).toBe('2025-12-29'); // el lunes de esa semana
    expect(trimestre.puntos.reduce((s, p) => s + p.citas, 0)).toBe(3);
    const anio = (await pedir({ desde: '2026-01-01', hasta: '2026-12-31' })).body.serie;
    expect(anio.unidad).toBe('mes');
    expect(anio.puntos).toHaveLength(12);
  });
});
