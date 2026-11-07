// Última línea de defensa: toda respuesta de error es JSON y nunca expone detalles
// internos. Express 5 trae aquí los errores de las rutas asíncronas.
const { registrarError } = require('./registros');

const MENSAJES = { 413: 'El contenido enviado es muy grande.' };

const rutaNoEncontrada = (req, res) => res.status(404).json({ error: 'Esta ruta no existe' });

// Express reconoce un manejador de errores porque recibe 4 argumentos.
function manejarErrores(err, req, res, next) {
  if (res.headersSent) return next(err);
  const estado = err.status || err.statusCode;
  if (estado >= 400 && estado < 500) return res.status(estado).json({ error: MENSAJES[estado] || 'La petición no es válida.' });
  registrarError(req, err);
  res.status(500).json({ error: 'Algo salió mal en el servidor. Intenta de nuevo.', peticion: req.id });
}

module.exports = { manejarErrores, rutaNoEncontrada };
