// Páginas de un listado. El tope evita que un número enorme llegue a la base de datos.
const PAGINA_MAXIMA = 100000;

const leerPagina = (valor) => Math.min(PAGINA_MAXIMA, Math.max(1, Number.parseInt(valor, 10) || 1));
const totalPaginas = (total, porPagina) => Math.max(1, Math.ceil(total / porPagina));

module.exports = { leerPagina, totalPaginas };
