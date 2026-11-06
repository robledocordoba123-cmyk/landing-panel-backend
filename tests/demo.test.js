const { execFileSync } = require('child_process');
const path = require('path');
const { prisma } = require('../app');

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
    correr();
    expect(await prisma.cita.count()).toBe(7);
    expect(await prisma.cliente.count()).toBe(7);
    expect(await prisma.vacuna.count()).toBe(3);
    expect(await prisma.atencion.count()).toBe(1);
  });

  test('se niega a correr sin DEMO=true', () => {
    expect(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo.js')], { env: { ...process.env, DEMO: '' }, stdio: 'pipe' })).toThrow();
  });
});
