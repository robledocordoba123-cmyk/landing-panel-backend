// Apagado ordenado: Render avisa con SIGTERM en cada despliegue. Se dejan terminar
// las peticiones en curso y se cierra la base de datos, para no cortar una reserva a
// la mitad. Si algo se queda colgado, se sale a la fuerza antes de que Render lo mate.
const { registro } = require('./registros');

const MS_LIMITE_APAGADO = 10000;

function crearApagado({ servidor, prisma, salir = process.exit, msLimite = MS_LIMITE_APAGADO }) {
  let apagando = false;
  return (senal, codigo = 0) => {
    if (apagando) return;
    apagando = true;
    registro.info('Apagando el servidor', { senal });
    const forzar = setTimeout(() => {
      registro.error('El apagado tardó demasiado: se fuerza la salida');
      salir(1);
    }, msLimite);
    forzar.unref();
    servidor.close(async () => {
      await prisma.$disconnect().catch(() => {});
      clearTimeout(forzar);
      salir(codigo);
    });
    servidor.closeIdleConnections?.();
  };
}

module.exports = { crearApagado };
