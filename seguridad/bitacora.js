// Bitácora: quién hizo qué, cuándo y desde dónde. Nunca guarda el contenido de
// una historia clínica ni contraseñas, solo que la acción ocurrió.
function registrar(prisma, req, accion, { entidad, entidadId, detalle, email } = {}) {
  return prisma.bitacora.create({
    data: {
      usuarioId: req.usuario?.id ?? null,
      usuarioEmail: (req.usuario?.email ?? email ?? null)?.slice(0, 120) ?? null,
      accion,
      entidad: entidad ?? null,
      entidadId: entidadId ?? null,
      detalle: detalle ?? null,
      ip: req.ip ?? null,
    },
  }).catch((err) => {
    // Un fallo aquí se avisa en los registros, pero no tumba la operación.
    console.error('No se pudo escribir en la bitácora', accion, err.message);
  });
}

const POR_PAGINA = 25;

async function leerBitacora(prisma, pagina) {
  const [registros, total] = await Promise.all([
    prisma.bitacora.findMany({ orderBy: { id: 'desc' }, skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
    prisma.bitacora.count(),
  ]);
  return { registros, pagina, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)), total };
}

module.exports = { registrar, leerBitacora };
