# Huellitas Veterinaria · API (backend)

API REST de Huellitas Veterinaria (negocio **ficticio**, proyecto de portafolio): agenda de citas con horarios reales, panel privado con login y asistente de WhatsApp.

**Demo en vivo:** [huellitas-veterinaria.vercel.app](https://huellitas-veterinaria.vercel.app) · API: [huellitas-api-s584.onrender.com](https://huellitas-api-s584.onrender.com) (plan gratis de Render: la primera petición puede tardar unos 50 segundos).

## Tecnologías

Node.js · Express 5 · PostgreSQL · Prisma · JWT · bcrypt · helmet · express-rate-limit

## Endpoints

| Método | Ruta | Descripción | Protegido |
|---|---|---|---|
| GET | `/api/servicios` | Servicios con duración y precio | No |
| GET | `/api/disponibilidad?servicioId=&fecha=YYYY-MM-DD` | Horarios libres de un servicio ese día | No |
| POST | `/api/citas` | Reserva una cita (con validación y límite de envíos) | No |
| GET | `/api/citas?desde=&hasta=` | Citas de un rango de fechas | Sí |
| PATCH | `/api/citas/:id/estado` | Cambia el estado de una cita | Sí |
| POST | `/api/mensajes` | Guarda una pregunta de la página (con validación y límite de envíos) | No |
| GET | `/api/mensajes?estado=NUEVO\|ATENDIDO` | Lista los mensajes y el conteo por estado | Sí |
| PATCH | `/api/mensajes/:id` | Marca un mensaje como atendido o lo devuelve a nuevo | Sí |
| POST | `/api/login` | Inicia sesión y devuelve un token (máximo 10 intentos fallidos cada 15 min) | No |

## Reglas de la agenda

- **Sin cruces, garantizado por la base de datos.** La restricción `cita_sin_cruces` (`EXCLUDE USING gist`) impide que dos citas del mismo recurso se pisen, aunque dos personas reserven en el mismo instante. Una consulta previa no bastaría: entre revisar y guardar, otra persona podría tomar el horario. Hay una prueba con 8 reservas simultáneas.
- **Recursos separados.** Consulta y vacunación comparten el consultorio; la peluquería tiene su propio espacio, así que puede coincidir con una consulta. Las urgencias no se reservan.
- **Horario del negocio.** Lunes a sábado de 8:00 a. m. a 7:00 p. m.; domingos y festivos de Colombia de 9:00 a. m. a 2:00 p. m. Los festivos se calculan por año, con Semana Santa y Ley Emiliani (`citas/festivos.js`).
- **Cada servicio tiene su duración.** Una cita debe terminar antes del cierre y los horarios empiezan cada 30 minutos.
- **Anticipación.** Se reserva con mínimo 1 hora y máximo 60 días. Un mismo correo puede tener hasta 3 citas pendientes.
- **Estados.** `PENDIENTE` → `CONFIRMADA` → `ATENDIDA` o `NO_ASISTIO`; se puede cancelar antes de atenderla, y cancelar libera el horario. Una cita no se marca atendida antes de su hora.
- **Privacidad.** La disponibilidad solo devuelve horarios libres, nunca quién reservó.

La página, el panel y el asistente usan la misma lógica (`citas/agenda.js`). Las fechas se guardan en UTC y se trabajan en hora de Colombia.

## Asistente de WhatsApp

Bot que atiende a los clientes por WhatsApp (`bot/`):

- Menú con servicios y precios, horarios y ubicación, **reservar cita** (pide nombre, mascota y servicio, ofrece los horarios libres del día que la persona escriba y deja la cita en la agenda) y **hablar con una persona**.
- Detecta urgencias ("envenenó", "no respira"…) y avisa al equipo de inmediato.
- Las citas llegan a la agenda con `origen = WHATSAPP`. Las urgencias y los pedidos de atención humana llegan a los mensajes del panel.
- Recuerda la conversación (tabla `ConversacionBot`) aunque el servidor se reinicie; tras 30 minutos sin respuesta vuelve a empezar.
- **IA opcional:** si se define `ANTHROPIC_API_KEY`, las preguntas libres las responde Claude con la información del negocio (`bot/negocio.js`) y sin dar diagnósticos. Sin clave, responde con sus reglas.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/webhook/whatsapp` | Verificación del webhook de Meta (WhatsApp Cloud API) |
| POST | `/webhook/whatsapp` | Mensajes entrantes; comprueba la firma `X-Hub-Signature-256` y responde por la API de WhatsApp |
| POST | `/api/bot/simulador` | El mismo bot para el simulador de la página |

Para conectarlo a un número real: crear la app en developers.facebook.com con WhatsApp, registrar el webhook `https://tu-api/webhook/whatsapp` y definir `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` y `WHATSAPP_APP_SECRET`. Sin esas variables el webhook responde 404.

## Seguridad

- Las contraseñas se guardan cifradas con bcrypt y el panel usa tokens JWT de 8 horas.
- **Ya no existe una ruta pública para crear administradores.** La cuenta del panel se crea solo desde la consola del servidor:
  ```bash
  ADMIN_EMAIL=correo@negocio.co ADMIN_PASSWORD='una-clave-larga' npm run crear-admin
  ```
- Validación de todos los campos, límite de envíos del formulario, encabezados de seguridad con helmet y CORS solo para el frontend configurado.

## Pruebas

61 pruebas con Jest y Supertest contra una base de datos PostgreSQL real (`huellitas_test`): agenda (festivos de 2026, horarios, cruces, reservas simultáneas, estados), formulario, login, panel, seguridad, conversación completa del bot, fechas escritas en el chat, urgencias, IA (simulada) y webhook firmado. Corren solas en GitHub Actions en cada cambio.

```bash
npm test        # aplica las migraciones a la base de pruebas y corre Jest
```

## Cómo correrlo

```bash
npm install
cp .env.example .env               # ajusta DATABASE_URL y JWT_SECRET
npx prisma migrate deploy
DEMO=true npm run demo             # opcional: datos de ejemplo y cuenta de demostración
npm run dev                        # http://localhost:3001
```

`npm run start:demo` aplica las migraciones, recarga los datos de ejemplo y enciende la API (pensado para la demo pública). El script de demo se niega a correr sin `DEMO=true`, porque borra las solicitudes.

## Publicación (demo)

- **Base de datos:** PostgreSQL en Neon (conexión directa, sin pooler, para que funcionen las migraciones).
- **API:** Render, plan gratis. Build: `npm install --include=dev && npx prisma generate` (Prisma está en devDependencies). Start: `npm run start:demo`.
- **Variables en Render:** `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN` (la dirección de la página en Vercel) y `TRUST_PROXY=3` (Render pone 3 proxies delante de la API; sin este valor el límite de intentos no ve la IP real).

## Frontend

[landing-panel-frontend](https://github.com/robledocordoba123-cmyk/landing-panel-frontend)

---
Diseño y desarrollo: Manuela Córdoba Robledo.

## Uso de inteligencia artificial

Este proyecto se desarrolló con apoyo de herramientas de IA (Claude Code). El diseño, las decisiones, la revisión del código y las pruebas son míos, y puedo explicar cada parte.
