const { execFileSync } = require('child_process');
const path = require('path');
const { prisma } = require('../app');
const { fechaLocal, instante, sumarDias } = require('../citas/horario');

// La API publicada arranca con este script: si falla, la demo no enciende.
describe('Datos de demostración', () => {
  afterAll(async () => {
    await prisma.atencion.deleteMany();
    await prisma.vacuna.deleteMany();
    await prisma.cita.deleteMany();
    await prisma.mascota.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.mensaje.deleteMany();
    await prisma.$disconnect();
  });

  test('se cargan sin errores y se pueden recargar', async () => {
    const correr = () => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo.js')], { env: { ...process.env, DEMO: 'true' }, stdio: 'pipe' });
    correr();
    const historial = await prisma.cita.count();
    // Alguien de la demo pública cambia el horario, cierra un día y crea un servicio.
    await prisma.jornada.update({ where: { dia: 1 }, data: { abierto: false } });
    await prisma.cierre.create({ data: { fecha: new Date('2030-01-02T00:00:00Z'), motivo: 'Prueba' } });
    await prisma.servicio.create({ data: { nombre: 'Servicio de un visitante', detalle: 'prueba', precioDesde: 1, duracionMin: 30, recurso: 'CONSULTORIO' } });
    await prisma.servicio.update({ where: { nombre: 'Vacunación' }, data: { precioDesde: 1, activo: false } });
    correr();
    expect(await prisma.cita.count()).toBe(historial);
    expect(historial).toBeGreaterThan(40);
    const desdeAyer = instante(sumarDias(fechaLocal(new Date()), -1), 0);
    expect(await prisma.cita.count({ where: { inicio: { gte: desdeAyer } } })).toBe(7);
    expect((await prisma.jornada.findUnique({ where: { dia: 1 } })).abierto).toBe(true);
    expect(await prisma.cierre.count()).toBe(0);
    expect(await prisma.servicio.count()).toBe(4);
    expect(await prisma.servicio.findUnique({ where: { nombre: 'Vacunación' } })).toMatchObject({ precioDesde: 45000, activo: true });
    expect(await prisma.cliente.count()).toBe(7);
    expect(await prisma.vacuna.count()).toBe(3);
    expect(await prisma.atencion.count()).toBe(1);
  });

  test('se niega a correr sin DEMO=true', () => {
    expect(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo.js')], { env: { ...process.env, DEMO: '' }, stdio: 'pipe' })).toThrow();
  });
});
