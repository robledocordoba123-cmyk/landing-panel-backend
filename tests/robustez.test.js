const request = require('supertest');
const express = require('express');
const { app, prisma } = require('../app');
const { sesionDe } = require('./ayuda');
const { crearApagado } = require('../plataforma/apagado');
const { manejarErrores } = require('../plataforma/errores');
const { leerPagina } = require('../plataforma/paginacion');
const { describirError, rutaSegura } = require('../plataforma/registros');
const { crearRutaSalud } = require('../plataforma/salud');

afterAll(() => prisma.$disconnect());

function appCon(ruta) {
  const prueba = express();
  prueba.get('/fallo', ruta);
  prueba.use(manejarErrores);
  return prueba;
}

describe('salud', () => {
  test('dice que está bien cuando llega a la base de datos', async () => {
    const res = await request(app).get('/api/salud');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'ok', baseDeDatos: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('responde 503 si la base de datos falla o no contesta', async () => {
    const espiar = jest.spyOn(console, 'error').mockImplementation(() => {});
    const falla = express().get('/s', crearRutaSalud({ $queryRaw: () => Promise.reject(new Error('caída')) }));
    expect((await request(falla).get('/s')).status).toBe(503);
    const colgada = express().get('/s', crearRutaSalud({ $queryRaw: () => new Promise(() => {}) }, 20));
    const res = await request(colgada).get('/s');
    expect(res.status).toBe(503);
    expect(res.body.baseDeDatos).toBe('sin_conexion');
    espiar.mockRestore();
  });
});

describe('errores', () => {
  test('una ruta que no existe responde JSON', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Esta ruta no existe');
  });

  test('un JSON mal formado es 400, sin detalles internos', async () => {
    const res = await request(app).post('/api/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La petición no es válida.' });
  });

  test('un cuerpo demasiado grande es 413', async () => {
    const res = await request(app).post('/api/login').send({ email: 'a'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  test('un error inesperado es 500 con el id de la petición, sin el mensaje interno', async () => {
    const prueba = appCon(async () => { throw new Error('password=secreta'); });
    const res = await request(prueba).get('/fallo');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secreta');
  });

  test('cada respuesta trae un id de petición', async () => {
    const res = await request(app).get('/api/salud');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('registros', () => {
  test('ocultan el enlace de Mi cita y la búsqueda', () => {
    expect(rutaSegura('/api/mi-cita/12.firma/cancelar')).toBe('/api/mi-cita/[oculto]/cancelar');
    expect(rutaSegura('/api/clientes?q=ana@correo.com')).toBe('/api/clientes');
  });

  test('no copian el mensaje de un error de Prisma, que puede traer datos personales', () => {
    const err = Object.assign(new Error('Invalid: ana@correo.com'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    const descripcion = describirError(err);
    expect(descripcion.codigo).toBe('P2002');
    expect(JSON.stringify(descripcion)).not.toContain('ana@correo.com');
  });

  test('escriben una línea JSON por petición, sin el cuerpo', async () => {
    process.env.PROBAR_REGISTROS = '1';
    const espiar = jest.spyOn(console, 'log').mockImplementation(() => {});
    await request(app).post('/api/mensajes').send({ nombre: 'Ana', email: 'ana@correo.com' });
    await new Promise((listo) => setImmediate(listo));
    const lineas = espiar.mock.calls.map(([l]) => l).filter((l) => l.includes('/api/mensajes'));
    espiar.mockRestore();
    delete process.env.PROBAR_REGISTROS;
    expect(JSON.parse(lineas[0])).toMatchObject({ nivel: 'info', metodo: 'POST', ruta: '/api/mensajes', estado: 400 });
    expect(lineas[0]).not.toContain('ana@correo.com');
  });
});

describe('apagado ordenado', () => {
  const preparar = () => {
    const servidor = { close: jest.fn((listo) => listo()), closeIdleConnections: jest.fn() };
    const prisma = { $disconnect: jest.fn().mockResolvedValue() };
    const salir = jest.fn();
    return { servidor, prisma, salir, apagar: crearApagado({ servidor, prisma, salir }) };
  };

  test('termina lo que hay en curso, cierra la base y sale con 0', async () => {
    const { servidor, prisma, salir, apagar } = preparar();
    apagar('SIGTERM');
    await new Promise((listo) => setImmediate(listo));
    expect(servidor.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(0);
  });

  test('un error fatal sale con 1 para que Render lo note', async () => {
    const { salir, apagar } = preparar();
    apagar('uncaughtException', 1);
    await new Promise((listo) => setImmediate(listo));
    expect(salir).toHaveBeenCalledWith(1);
  });

  test('una segunda señal no apaga dos veces', () => {
    const { servidor, apagar } = preparar();
    apagar('SIGTERM');
    apagar('SIGTERM');
    expect(servidor.close).toHaveBeenCalledTimes(1);
  });

  test('si algo se queda colgado, fuerza la salida', async () => {
    const salir = jest.fn();
    const apagar = crearApagado({ servidor: { close: () => {} }, prisma: {}, salir, msLimite: 10 });
    apagar('SIGTERM');
    await new Promise((listo) => setTimeout(listo, 30));
    expect(salir).toHaveBeenCalledWith(1);
  });
});

describe('paginación', () => {
  test('lee la página sin dejar pasar valores raros', () => {
    expect(leerPagina('3')).toBe(3);
    expect(leerPagina('-2')).toBe(1);
    expect(leerPagina('abc')).toBe(1);
    expect(leerPagina(undefined)).toBe(1);
    expect(leerPagina('99999999999999')).toBe(100000);
  });

  describe('de clientes', () => {
    let cookie;
    const listar = (consulta) => request(app).get('/api/clientes').query(consulta).set('Cookie', cookie);

    beforeAll(async () => {
      await prisma.cita.deleteMany();
      await prisma.mascota.deleteMany();
      await prisma.cliente.deleteMany();
      await prisma.cliente.createMany({
        data: Array.from({ length: 45 }, (_, i) => ({ nombre: `Cliente ${String(i).padStart(2, '0')}`, email: `c${i}@correo.com` })),
      });
      await prisma.cliente.create({ data: { nombre: 'Único Buscado', email: 'unico@correo.com' } });
      cookie = await sesionDe(prisma, { email: 'paginas@prueba.com' });
    });

    test('recorre todos los clientes sin repetir ni perder ninguno', async () => {
      const uno = (await listar({})).body;
      expect(uno).toMatchObject({ pagina: 1, paginas: 3, total: 46 });
      expect(uno.clientes).toHaveLength(20);
      const dos = (await listar({ pagina: 2 })).body;
      const tres = (await listar({ pagina: 3 })).body;
      const ids = [...uno.clientes, ...dos.clientes, ...tres.clientes].map((c) => c.id);
      expect(new Set(ids).size).toBe(46);
    });

    test('el total respeta la búsqueda', async () => {
      const { body } = await listar({ q: 'único' });
      expect(body).toMatchObject({ total: 1, paginas: 1 });
      expect(body.clientes[0].nombre).toBe('Único Buscado');
    });

    test('una página que no existe viene vacía, no falla', async () => {
      const res = await listar({ pagina: 99999999999 });
      expect(res.status).toBe(200);
      expect(res.body.clientes).toEqual([]);
    });
  });
});
