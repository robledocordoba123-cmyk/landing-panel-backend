// Reglas de tiempo de la agenda. Colombia no cambia de hora, así que la zona
// horaria es siempre UTC-5. Las fechas se guardan en UTC en la base de datos.
const { esFestivo } = require('./festivos');

const OFFSET = '-05:00';
const OFFSET_MS = 5 * 60 * 60 * 1000;
const MINUTO = 60 * 1000;

const PASO_MIN = 30; // cada cuánto puede empezar una cita
const ANTICIPACION_MIN = 60; // no se reserva para dentro de menos de una hora
const DIAS_MAXIMOS = 60; // hasta cuándo se puede reservar

const FESTIVOS = 7; // la jornada de los festivos se guarda como un día más
const NORMAL = { abierto: true, abre: 8 * 60, cierra: 19 * 60 };
const REDUCIDA = { abierto: true, abre: 9 * 60, cierra: 14 * 60 };

// El horario con el que nace la base de datos. Lo usan las reglas puras y sus pruebas;
// la agenda real lee el de la base (citas/calendario.js).
const CALENDARIO_POR_DEFECTO = {
  jornadas: new Map([0, 1, 2, 3, 4, 5, 6, FESTIVOS].map((d) => [d, d === 0 || d === FESTIVOS ? REDUCIDA : NORMAL])),
  cierres: new Map(),
};

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

const claveDia = (fecha) => (esFestivo(fecha) ? FESTIVOS : diaSemana(fecha));

// Horas de atención de un día, o null si ese día no se abre.
function jornadaDe(fecha, calendario = CALENDARIO_POR_DEFECTO) {
  if (calendario.cierres.has(fecha)) return null;
  const jornada = calendario.jornadas.get(claveDia(fecha));
  return jornada?.abierto ? { abre: jornada.abre, cierra: jornada.cierra } : null;
}

// Horarios en que puede empezar un servicio ese día, sin mirar lo ya reservado.
function horariosPosibles(fecha, duracionMin, ahora = new Date(), calendario = CALENDARIO_POR_DEFECTO) {
  const hoy = fechaLocal(ahora);
  if (fecha < hoy || fecha > sumarDias(hoy, DIAS_MAXIMOS)) return [];
  const jornada = jornadaDe(fecha, calendario);
  if (!jornada) return [];
  const { abre, cierra } = jornada;
  const minimo = ahora.getTime() + ANTICIPACION_MIN * MINUTO;
  const horarios = [];
  for (let m = abre; m + duracionMin <= cierra; m += PASO_MIN) {
    const inicio = instante(fecha, m);
    if (inicio.getTime() >= minimo) horarios.push(inicio);
  }
  return horarios;
}

const textoHora = (m) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const horaLegible = (inicio) => textoHora(minutosLocales(inicio));

const NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const igual = (a, b) => a && b && a.abierto === b.abierto && (!a.abierto || (a.abre === b.abre && a.cierra === b.cierra));
const textoJornada = (j) => (j?.abierto ? `${textoHora(j.abre)} – ${textoHora(j.cierra)}` : 'cerrado');

// El horario en frases ("Lunes a sábado: 8:00 a. m. – 7:00 p. m."), juntando los días
// seguidos que abren igual. Lo usan la página, el asistente y la IA.
function lineasHorario(calendario = CALENDARIO_POR_DEFECTO) {
  const grupos = [];
  for (const dia of ORDEN) {
    const jornada = calendario.jornadas.get(dia);
    const ultimo = grupos.at(-1);
    if (ultimo && igual(ultimo.jornada, jornada)) ultimo.dias.push(dia);
    else grupos.push({ dias: [dia], jornada });
  }
  const festivos = calendario.jornadas.get(FESTIVOS);
  const nombre = ({ dias }) => {
    if (dias.length === 1) return dias[0] === 0 ? 'Domingos' : NOMBRES[dias[0]];
    const ultimo = NOMBRES[dias.at(-1)].toLowerCase();
    return `${NOMBRES[dias[0]]} ${dias.length === 2 ? 'y' : 'a'} ${ultimo}`;
  };
  const domingo = grupos.at(-1);
  const juntarFestivos = domingo.dias.length === 1 && igual(domingo.jornada, festivos);
  const lineas = grupos.map((g) => `${nombre(g)}${g === domingo && juntarFestivos ? ' y festivos' : ''}: ${textoJornada(g.jornada)}`);
  if (!juntarFestivos) lineas.push(`Festivos: ${textoJornada(festivos)}`);
  return lineas;
}

const fechaLegible = (inicio) => inicio.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });

const finDe = (inicio, duracionMin) => new Date(inicio.getTime() + duracionMin * MINUTO);

module.exports = {
  CALENDARIO_POR_DEFECTO, DIAS_MAXIMOS, FESTIVOS, fechaValida, fechaLocal, sumarDias, diaSemana, instante, jornadaDe,
  horariosPosibles, horaLegible, textoHora, fechaLegible, finDe, minutosLocales, lineasHorario,
};
