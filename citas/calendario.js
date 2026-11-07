// Calendario del negocio (jornada de cada día y días cerrados), editable desde el
// panel. Se consulta en cada búsqueda de horarios, así que se guarda en memoria un
// minuto; quien lo cambia la limpia. El minuto cubre el caso de varias instancias.
const { fechaLocal, sumarDias } = require('./horario');

const MS_MEMORIA = 60 * 1000;
let memoria = null;

async function leerCalendario(prisma) {
  if (memoria && memoria.vence > Date.now()) return memoria.calendario;
  const ayer = sumarDias(fechaLocal(new Date()), -1);
  const [jornadas, cierres] = await Promise.all([
    prisma.jornada.findMany(),
    prisma.cierre.findMany({ where: { fecha: { gte: new Date(`${ayer}T00:00:00Z`) } }, orderBy: { fecha: 'asc' } }),
  ]);
  const calendario = {
    jornadas: new Map(jornadas.map((j) => [j.dia, { abierto: j.abierto, abre: j.abre, cierra: j.cierra }])),
    cierres: new Map(cierres.map((c) => [c.fecha.toISOString().slice(0, 10), c.motivo])),
  };
  memoria = { calendario, vence: Date.now() + MS_MEMORIA };
  return calendario;
}

const olvidarCalendario = () => {
  memoria = null;
};

module.exports = { leerCalendario, olvidarCalendario };
