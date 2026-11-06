// Reglas de tiempo de la agenda. Colombia no cambia de hora, así que la zona
// horaria es siempre UTC-5. Las fechas se guardan en UTC en la base de datos.
const { esFestivo } = require('./festivos');

const OFFSET = '-05:00';
const OFFSET_MS = 5 * 60 * 60 * 1000;
const MINUTO = 60 * 1000;

const PASO_MIN = 30; // cada cuánto puede empezar una cita
const ANTICIPACION_MIN = 60; // no se reserva para dentro de menos de una hora
const DIAS_MAXIMOS = 60; // hasta cuándo se puede reservar

const JORNADA_NORMAL = { abre: 8 * 60, cierra: 19 * 60 };
const JORNADA_REDUCIDA = { abre: 9 * 60, cierra: 14 * 60 };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// true solo si el texto es una fecha que existe (rechaza 2026-02-31).
function fechaValida(fecha) {
  if (typeof fecha !== 'string' || !FECHA.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

const fechaLocal = (momento) => new Date(momento.getTime() - OFFSET_MS).toISOString().slice(0, 10);
const minutosLocales = (momento) => {
  const d = new Date(momento.getTime() - OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo

function sumarDias(fecha, dias) {
  return new Date(new Date(`${fecha}T00:00:00Z`).getTime() + dias * 24 * 60 * MINUTO).toISOString().slice(0, 10);
}

function instante(fecha, minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');
  return new Date(`${fecha}T${hh}:${mm}:00${OFFSET}`);
}

const jornadaDe = (fecha) => (diaSemana(fecha) === 0 || esFestivo(fecha) ? JORNADA_REDUCIDA : JORNADA_NORMAL);

// Horarios en que puede empezar un servicio ese día, sin mirar lo ya reservado.
function horariosPosibles(fecha, duracionMin, ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  if (fecha < hoy || fecha > sumarDias(hoy, DIAS_MAXIMOS)) return [];
  const { abre, cierra } = jornadaDe(fecha);
  const minimo = ahora.getTime() + ANTICIPACION_MIN * MINUTO;
  const horarios = [];
  for (let m = abre; m + duracionMin <= cierra; m += PASO_MIN) {
    const inicio = instante(fecha, m);
    if (inicio.getTime() >= minimo) horarios.push(inicio);
  }
  return horarios;
}

const horaLegible = (inicio) => {
  const m = minutosLocales(inicio);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

const fechaLegible = (inicio) => inicio.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });

const finDe = (inicio, duracionMin) => new Date(inicio.getTime() + duracionMin * MINUTO);

module.exports = { fechaValida, fechaLocal, sumarDias, diaSemana, instante, jornadaDe, horariosPosibles, horaLegible, fechaLegible, finDe, DIAS_MAXIMOS };
