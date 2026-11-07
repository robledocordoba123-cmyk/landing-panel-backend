// Ruta de salud: dice si el servicio puede atender de verdad, es decir, si llega a
// la base de datos. Responde 503 si no, y así un monitor externo lo puede detectar.
const { describirError, registro } = require('./registros');

const MS_LIMITE_BD = 5000;

function conLimite(promesa, ms) {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error('La base de datos no respondió a tiempo')), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

function crearRutaSalud(prisma, msLimite = MS_LIMITE_BD) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local';
    try {
      await conLimite(prisma.$queryRaw`SELECT 1`, msLimite);
      res.json({ estado: 'ok', baseDeDatos: 'ok', version });
    } catch (err) {
      registro.error('La ruta de salud no llegó a la base de datos', describirError(err));
      res.status(503).json({ estado: 'con_fallas', baseDeDatos: 'sin_conexion', version });
    }
  };
}

module.exports = { crearRutaSalud };
