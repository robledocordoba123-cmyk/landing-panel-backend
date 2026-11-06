// Une cada reserva con su cliente y su mascota. Quien reserva se identifica por
// el correo: si ya existe, la cita se suma a su historial. Como reservar es
// público, una reserva nunca cambia los datos de un cliente que ya existe.
const ESPECIES = ['Perro', 'Gato', 'Ave', 'Conejo', 'Otro'];

const PALABRAS = [
  [/perr[oa]|cachorr/, 'Perro'],
  [/gat[oa]|minin/, 'Gato'],
  [/ave|lor[oa]|pajar|canari|periquit|cacatua/, 'Ave'],
  [/conej/, 'Conejo'],
];

// El chat escribe la mascota en una sola línea: "Toby, perro" o "Misha (gata)".
function leerMascota(texto) {
  const [nombre, ...resto] = texto.split(/[,(]/);
  const descripcion = resto.join(' ').toLowerCase();
  const especie = PALABRAS.find(([patron]) => patron.test(descripcion))?.[1] || 'Otro';
  return { nombre: nombre.trim(), especie };
}

// tx: cliente de Prisma dentro de la transacción que crea la cita.
async function asegurarMascota(tx, { nombre, email, telefono, mascota, especie }) {
  const cliente = await tx.cliente.upsert({ where: { email }, update: {}, create: { nombre, email, telefono } });
  const existente = await tx.mascota.findFirst({
    where: { clienteId: cliente.id, nombre: { equals: mascota, mode: 'insensitive' } },
  });
  return existente || tx.mascota.create({ data: { clienteId: cliente.id, nombre: mascota, especie } });
}

module.exports = { ESPECIES, leerMascota, asegurarMascota };
