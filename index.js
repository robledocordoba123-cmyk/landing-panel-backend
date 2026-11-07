const { app, prisma } = require('./app');
const { crearApagado } = require('./plataforma/apagado');
const { describirError, registro } = require('./plataforma/registros');

const PORT = process.env.PORT || 3001;

const servidor = app.listen(PORT, () => {
  registro.info('Servidor encendido', { puerto: Number(PORT) });
});

const apagar = crearApagado({ servidor, prisma });
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

// Después de un error que nadie atrapó, el proceso queda en un estado desconocido:
// se registra, se apaga con código 1 y Render lo levanta limpio.
process.on('unhandledRejection', (motivo) => {
  registro.error('Promesa rechazada sin manejar', describirError(motivo));
  apagar('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  registro.error('Excepción sin manejar', describirError(err));
  apagar('uncaughtException', 1);
});
