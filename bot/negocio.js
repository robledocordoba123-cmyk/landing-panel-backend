// Información del negocio que usa el asistente. Huellitas es una veterinaria
// ficticia (proyecto de portafolio): para otro negocio basta con cambiar este
// archivo.
module.exports = {
  nombre: 'Huellitas Veterinaria',
  servicios: [
    { nombre: 'Consulta general', detalle: 'revisión completa y tratamiento', desde: 60000 },
    { nombre: 'Vacunación', detalle: 'plan de vacunas y desparasitación', desde: 45000 },
    { nombre: 'Peluquería', detalle: 'baño, corte, oídos y uñas', desde: 50000 },
    { nombre: 'Urgencias', detalle: 'atención prioritaria todos los días', desde: 90000 },
  ],
  horarios: [
    'Lunes a sábado: 8:00 a. m. – 7:00 p. m.',
    'Domingos y festivos: 9:00 a. m. – 2:00 p. m.',
    'Urgencias: todos los días',
  ],
  ubicacion: 'Medellín, Antioquia (dirección de ejemplo en la demo)',
  pagos: 'efectivo, tarjeta, Nequi y transferencia',
};
