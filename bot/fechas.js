// Entiende la fecha que escribe una persona en el chat: "hoy", "mañana",
// "sábado", "15/11" o "15 de noviembre". El texto llega normalizado (minúsculas
// y sin tildes). Devuelve "YYYY-MM-DD" o null si no la entiende.
const { diaSemana, fechaValida, sumarDias } = require('../citas/horario');

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Una fecha sin año es la próxima vez que llegue ese día.
function conAnio(dia, mes, anioEscrito, hoy) {
  const armar = (anio) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  if (anioEscrito) {
    const fecha = armar(anioEscrito < 100 ? 2000 + anioEscrito : anioEscrito);
    return fechaValida(fecha) ? fecha : null;
  }
  const anio = Number(hoy.slice(0, 4));
  const fecha = armar(anio);
  if (!fechaValida(fecha)) return null;
  return fecha >= hoy ? fecha : armar(anio + 1);
}

function interpretarFecha(texto, hoy) {
  const t = texto.replace(/^(para |el |este |este dia )+/, '').trim();
  if (t === 'hoy') return hoy;
  if (t === 'manana') return sumarDias(hoy, 1);
  if (t === 'pasado manana') return sumarDias(hoy, 2);

  const dia = DIAS.indexOf(t);
  if (dia >= 0) return sumarDias(hoy, (dia - diaSemana(hoy) + 7) % 7);

  const numerica = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if (numerica) return conAnio(Number(numerica[1]), Number(numerica[2]), Number(numerica[3]) || null, hoy);

  const conMes = t.match(/^(\d{1,2}) de ([a-z]+)$/);
  if (conMes && MESES.includes(conMes[2])) return conAnio(Number(conMes[1]), MESES.indexOf(conMes[2]) + 1, null, hoy);

  return null;
}

module.exports = { interpretarFecha };
