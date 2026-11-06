// Festivos de Colombia. Se calculan por año porque varios dependen de la Semana
// Santa y otros se corren al lunes siguiente (Ley Emiliani, Ley 51 de 1983).
const UN_DIA = 24 * 60 * 60 * 1000;

const utc = (anio, mes, dia) => new Date(Date.UTC(anio, mes - 1, dia));
const sumarDias = (fecha, dias) => new Date(fecha.getTime() + dias * UN_DIA);
const texto = (fecha) => fecha.toISOString().slice(0, 10);

// Si la fecha no cae en lunes, pasa al lunes siguiente.
function alLunes(fecha) {
  const dia = fecha.getUTCDay();
  return dia === 1 ? fecha : sumarDias(fecha, (8 - dia) % 7);
}

// Domingo de Pascua (algoritmo de Butcher).
function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(anio, mes, dia);
}

function festivosDelAnio(anio) {
  const p = pascua(anio);
  const fijos = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].map(([m, d]) => utc(anio, m, d));
  const emiliani = [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => alLunes(utc(anio, m, d)));
  const semanaSanta = [-3, -2].map((d) => sumarDias(p, d));
  // Ascensión, Corpus Christi y Sagrado Corazón ya quedan en lunes con estos días.
  const moviles = [43, 64, 71].map((d) => sumarDias(p, d));
  return new Set([...fijos, ...emiliani, ...semanaSanta, ...moviles].map(texto));
}

const cache = new Map();

// fecha: "YYYY-MM-DD"
function esFestivo(fecha) {
  const anio = Number(fecha.slice(0, 4));
  if (!cache.has(anio)) cache.set(anio, festivosDelAnio(anio));
  return cache.get(anio).has(fecha);
}

module.exports = { esFestivo, festivosDelAnio };
