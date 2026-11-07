// Preguntas que llegan desde el formulario de la página y por WhatsApp. Enviar es
// público (con límite); leerlas y marcarlas es del equipo.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { leerPagina, totalPaginas } = require('../plataforma/paginacion');
const { registrarError } = require('../plataforma/registros');

const SERVICIOS = ['Consulta general', 'Vacunación', 'Peluquería', 'Urgencias', 'Otro'];
const ESTADOS = ['NUEVO', 'ATENDIDO'];
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POR_PAGINA = 20;

// El formulario es público: se limita para que nadie lo use para llenar la base de datos.
const limiteFormulario = rateLimit({ skip: () => process.env.NODE_ENV === 'test', windowMs: 15 * 60 * 1000, limit: 10, message: { error: 'Enviaste muchas solicitudes. Intenta de nuevo en unos minutos.' } });

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// Revisa los datos del formulario y devuelve el primer error que encuentre.
function validarSolicitud({ nombre, email, telefono, mascota, servicio, mensaje, autorizaDatos }) {
  if (texto(nombre).length < 2 || texto(nombre).length > 80) return 'Escribe tu nombre (entre 2 y 80 letras).';
  if (!CORREO.test(texto(email)) || texto(email).length > 120) return 'Escribe un correo válido.';
  if (telefono && !/^[\d\s+()-]{7,20}$/.test(texto(telefono))) return 'El teléfono no es válido.';
  if (mascota && texto(mascota).length > 60) return 'El nombre de la mascota es muy largo.';
  if (servicio && !SERVICIOS.includes(servicio)) return 'Elige un servicio de la lista.';
  if (texto(mensaje).length < 5 || texto(mensaje).length > 1000) return 'Cuéntanos qué necesitas (entre 5 y 1000 letras).';
  if (autorizaDatos !== true) return 'Debes autorizar el tratamiento de tus datos para enviar el mensaje.';
  return null;
}

function crearRutasMensajes(prisma, verificarSesion) {
  const rutas = express.Router();

  rutas.post('/mensajes', limiteFormulario, async (req, res) => {
    const error = validarSolicitud(req.body || {});
    if (error) return res.status(400).json({ error });
    const { nombre, email, telefono, mascota, servicio, mensaje } = req.body;
    try {
      const nueva = await prisma.mensaje.create({
        data: {
          nombre: nombre.trim(),
          email: email.trim().toLowerCase(),
          telefono: telefono?.trim() || null,
          mascota: mascota?.trim() || null,
          servicio: servicio || null,
          mensaje: mensaje.trim(),
          autorizaDatosEn: new Date(),
        },
        select: { id: true, creadoEn: true },
      });
      res.status(201).json(nueva);
    } catch (err) {
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudo guardar la solicitud' });
    }
  });

  // ?estado=NUEVO|ATENDIDO&pagina=N. El resumen cuenta todos, sin importar el filtro.
  rutas.get('/mensajes', verificarSesion, async (req, res) => {
    const { estado } = req.query;
    if (estado && !ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
    const pagina = leerPagina(req.query.pagina);
    const where = estado ? { estado } : {};
    try {
      const [mensajes, total, porEstado] = await Promise.all([
        prisma.mensaje.findMany({ where, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
        prisma.mensaje.count({ where }),
        prisma.mensaje.groupBy({ by: ['estado'], _count: { _all: true } }),
      ]);
      const resumen = Object.fromEntries(ESTADOS.map((e) => [e, porEstado.find((p) => p.estado === e)?._count._all || 0]));
      res.json({ mensajes, resumen, pagina, paginas: totalPaginas(total, POR_PAGINA), total });
    } catch (err) {
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudieron obtener las solicitudes' });
    }
  });

  rutas.patch('/mensajes/:id', verificarSesion, async (req, res) => {
    const id = Number(req.params.id);
    const { estado } = req.body || {};
    if (!Number.isInteger(id) || !ESTADOS.includes(estado)) return res.status(400).json({ error: 'Datos no válidos' });
    try {
      res.json(await prisma.mensaje.update({ where: { id }, data: { estado, atendidoEn: estado === 'ATENDIDO' ? new Date() : null } }));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'La solicitud no existe' });
      registrarError(req, err);
      res.status(500).json({ error: 'No se pudo actualizar la solicitud' });
    }
  });

  return rutas;
}

module.exports = { crearRutasMensajes };
