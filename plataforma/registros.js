// Registros en JSON, una línea por evento, para poder filtrarlos en Render. Nunca
// llevan cuerpos ni parámetros de búsqueda, y el enlace de "Mi cita" se oculta:
// un registro no debe convertirse en otra copia de los datos de los clientes.
const { randomUUID } = require('crypto');

function escribir(nivel, mensaje, datos = {}) {
  if (process.env.NODE_ENV === 'test' && !process.env.PROBAR_REGISTROS) return;
  const salida = nivel === 'error' ? console.error : console.log;
  salida(JSON.stringify({ fecha: new Date().toISOString(), nivel, mensaje, ...datos }));
}

const registro = {
  info: (mensaje, datos) => escribir('info', mensaje, datos),
  aviso: (mensaje, datos) => escribir('aviso', mensaje, datos),
  error: (mensaje, datos) => escribir('error', mensaje, datos),
};

const rutaSegura = (url = '') => url.split('?')[0].replace(/(\/mi-cita\/)[^/]+/, '$1[oculto]');

// Los mensajes de Prisma pueden repetir los valores de la consulta: de esos errores
// solo se guardan el tipo, el código y dónde ocurrió.
function describirError(err) {
  const pila = String(err?.stack || '').split('\n').filter((l) => l.trim().startsWith('at ')).slice(0, 8).map((l) => l.trim());
  const esPrisma = String(err?.name).startsWith('Prisma');
  return { tipo: err?.name, codigo: err?.code, detalle: esPrisma ? undefined : err?.message, pila };
}

const registrarError = (req, err) => {
  registro.error('Error en una petición', { peticion: req.id, ruta: rutaSegura(req.originalUrl), ...describirError(err) });
};

// Da a cada petición un id, que viaja en X-Request-Id para encontrarla en los registros.
function registrarPeticiones(req, res, next) {
  const inicio = process.hrtime.bigint();
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    const nivel = res.statusCode >= 500 ? 'error' : 'info';
    registro[nivel]('Petición', { peticion: req.id, metodo: req.method, ruta: rutaSegura(req.originalUrl), estado: res.statusCode, ms });
  });
  next();
}

module.exports = { describirError, registrarError, registrarPeticiones, registro, rutaSegura };
