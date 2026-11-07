# Huellitas Veterinaria · API (backend)

API REST de Huellitas Veterinaria (negocio **ficticio**, proyecto de portafolio): agenda de citas con horarios reales, panel privado con login y asistente de WhatsApp.

**Demo en vivo:** [huellitas-veterinaria.vercel.app](https://huellitas-veterinaria.vercel.app) · API: [huellitas-api-s584.onrender.com](https://huellitas-api-s584.onrender.com) (plan gratis de Render: la primera petición puede tardar unos 50 segundos).

## Tecnologías

Node.js 22 · Express 5 · PostgreSQL · Prisma 6 · JWT · bcrypt · helmet · express-rate-limit

## Endpoints

| Método | Ruta | Descripción | Protegido |
|---|---|---|---|
| GET | `/api/servicios` | Servicios con duración y precio | No |
| GET | `/api/disponibilidad?servicioId=&fecha=YYYY-MM-DD` | Horarios libres de un servicio ese día | No |
| POST | `/api/citas` | Reserva una cita (con validación y límite de envíos) | No |
| GET | `/api/citas?desde=&hasta=` | Citas de un rango de fechas | Sí |
| PATCH | `/api/citas/:id/estado` | Cambia el estado de una cita | Sí |
| GET | `/api/salud` | Dice si la API llega a la base de datos (200 o 503) | No |
| GET | `/api/clientes?q=&pagina=` | Busca clientes por nombre, teléfono, correo o mascota, de a 20 | Sí |
| GET, PATCH | `/api/clientes/:id` | Ver o corregir un cliente | Sí |
| POST | `/api/clientes/:id/mascotas` | Agrega una mascota | Sí |
| GET, PATCH | `/api/mascotas/:id` | Ficha completa (cliente, historia, vacunas y citas) o corregir datos | Sí |
| POST | `/api/mascotas/:id/atenciones` | Registra una atención; con `citaId` marca la cita como atendida | Sí |
| POST | `/api/mascotas/:id/vacunas` | Registra una vacuna | Sí |
| DELETE | `/api/vacunas/:id` | Borra una vacuna mal registrada | Sí |
| GET | `/api/vacunas/por-vencer` | Vacunas vencidas o que vencen en 30 días | Sí |
| GET | `/api/mi-cita/:token` | El cliente ve su cita con el enlace | No (enlace firmado) |
| POST | `/api/mi-cita/:token/cancelar` | El cliente cancela su cita | No (enlace firmado) |
| POST | `/api/mi-cita/:token/cambiar` | El cliente cambia la fecha | No (enlace firmado) |
| GET | `/api/notificaciones?pagina=` | Registro de correos, de a 25 | Sí |
| POST | `/api/recordatorios` | Envía los recordatorios de mañana | Sí |
| POST | `/api/tareas/recordatorios` | Lo mismo, para la tarea diaria | Token de tarea |
| POST | `/api/mensajes` | Guarda una pregunta de la página (con validación y límite de envíos) | No |
| GET | `/api/mensajes?estado=NUEVO\|ATENDIDO&pagina=` | Lista los mensajes de a 20 y el conteo por estado | Sí |
| PATCH | `/api/mensajes/:id` | Marca un mensaje como atendido o lo devuelve a nuevo | Sí |
| POST | `/api/login` | Inicia sesión con cookie (máximo 10 intentos fallidos cada 15 min) | No |
| POST | `/api/logout` | Cierra la sesión | Sí |
| GET | `/api/sesion` | Quién inició sesión | Sí |
| POST | `/api/sesion/clave` | Cambia la contraseña propia | Sí |
| GET, POST | `/api/usuarios` | Cuentas del equipo | Administración |
| PATCH | `/api/usuarios/:id` | Cambia rol o desactiva | Administración |
| GET | `/api/bitacora?pagina=` | Registro de acciones | Administración |
| GET | `/api/horario` | Horario en frases, jornada de cada día y días cerrados | No |
| PUT | `/api/horario` | Cambia el horario (rechaza el cambio si deja citas por fuera) | Administración |
| POST, DELETE | `/api/cierres`, `/api/cierres/:fecha` | Cierra o vuelve a abrir un día | Administración |
| GET | `/api/servicios/todos` | Servicios, también los ocultos | Administración |
| POST, PATCH | `/api/servicios`, `/api/servicios/:id` | Crea o edita un servicio (precio, duración, si se reserva en línea) | Administración |
| GET | `/api/reportes?desde=&hasta=` | Citas, ingresos estimados, inasistencia y comparación con el periodo anterior | Administración |
| POST | `/api/clientes/:id/suprimir` | Suprime los datos personales | Administración |

## Reglas de la agenda

- **Sin cruces, garantizado por la base de datos.** La restricción `cita_sin_cruces` (`EXCLUDE USING gist`) impide que dos citas del mismo recurso se pisen, aunque dos personas reserven en el mismo instante. Una consulta previa no bastaría: entre revisar y guardar, otra persona podría tomar el horario. Hay una prueba con 8 reservas simultáneas.
- **Recursos separados.** Consulta y vacunación comparten el consultorio; la peluquería tiene su propio espacio, así que puede coincidir con una consulta. Las urgencias no se reservan.
- **Horario del negocio.** Lunes a sábado de 8:00 a. m. a 7:00 p. m.; domingos y festivos de Colombia de 9:00 a. m. a 2:00 p. m. Los festivos se calculan por año, con Semana Santa y Ley Emiliani (`citas/festivos.js`).
- **Cada servicio tiene su duración.** Una cita debe terminar antes del cierre y los horarios empiezan cada 30 minutos.
- **Anticipación.** Se reserva con mínimo 1 hora y máximo 60 días. Un mismo correo puede tener hasta 3 citas pendientes.
- **Estados.** `PENDIENTE` → `CONFIRMADA` → `ATENDIDA` o `NO_ASISTIO`; se puede cancelar antes de atenderla, y cancelar libera el horario. Una cita no se marca atendida antes de su hora.
- **Privacidad.** La disponibilidad solo devuelve horarios libres, nunca quién reservó.

La página, el panel y el asistente usan la misma lógica (`citas/agenda.js`). Las fechas se guardan en UTC y se trabajan en hora de Colombia.

## Horario, servicios y reportes

- **El horario vive en la base de datos** (`Jornada` por día y para festivos, `Cierre` para días sin atención) y se edita desde el panel. La página, la reserva, el enlace del cliente y el asistente leen el mismo calendario.
- **Un cambio no deja clientes colgados.** Si el horario nuevo o un día cerrado dejaría por fuera citas ya reservadas, se rechaza y dice cuáles son.
- **Los servicios no se borran, se ocultan**: hay citas que los usan. Cambiar la duración no mueve las citas ya reservadas.
- **Reportes** con comparación contra el periodo anterior de igual largo. Los ingresos son estimados con el precio base, porque la atención no guarda lo cobrado.
- **La demo pública se restablece** en cada arranque (horario, servicios y ocho semanas de historial), para que ningún visitante la deje cerrada.

## Clientes, mascotas e historia clínica

- **El cliente se crea solo al reservar** y el correo lo identifica. Con el mismo correo y la misma mascota no se duplica nada, aunque cambien las mayúsculas.
- **Reservar es público, así que una reserva nunca cambia los datos de un cliente que ya existe.** Solo el equipo puede corregirlos desde el panel.
- **Todo o nada.** El cliente, la mascota y la cita se guardan en una transacción: si el horario se pierde, no queda un cliente suelto. Atender una cita guarda la historia y marca la cita en una sola operación.
- **Historia clínica:** motivo, peso, temperatura, diagnóstico, tratamiento y quién lo registró.
- **Carné de vacunas:** se imprime desde la ficha. El panel avisa las vacunas vencidas o que vencen en 30 días; si la mascota ya recibió una dosis más reciente de la misma vacuna, la anterior deja de avisar.

## Correos y enlace del cliente

- **Enlace sin cuenta.** Cada cita tiene un enlace firmado con HMAC: no se puede adivinar, no sirve para otra cita y muestra solo lo necesario, nunca el correo ni el teléfono.
- **Cancelar o cambiar hasta 2 horas antes.** Al cambiar, la cita vuelve a pendiente para que el equipo confirme la nueva hora. La regla de no cruzarse sigue en la base de datos.
- **Correos:** reserva recibida, confirmación, cambio, cancelación y recordatorio un día antes. Cada uno queda registrado con su resultado.
- **Un correo que falla no daña la reserva.** Y el recordatorio fallido se reintenta; el que ya salió no se repite.
- **Recordatorio diario** con GitHub Actions (`recordatorios.yml`), porque en el plan gratis el servidor se apaga sin visitas. Es opcional: se activa con el secreto `TAREAS_TOKEN`.
- **La demo pública no envía correos.** Sin `BREVO_API_KEY` quedan como `SIMULADA`. Es a propósito: en una página abierta, cualquiera podría escribir un correo ajeno y hacer que la API le escriba.

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

## Seguridad y datos personales

- **Sesión en cookie `httpOnly`, `Secure` y `SameSite=Strict`.** JavaScript no puede leerla, así un script inyectado no se la roba. La página llama a la API por su misma dirección (Vercel redirige `/api`), por eso la cookie es del mismo sitio.
- **Roles:** administración, veterinario y recepción. Recepción maneja agenda y contactos, pero la API no le entrega la historia clínica. Los permisos se revisan en el servidor, no solo se esconden en la pantalla.
- **Cambios inmediatos.** Cada petición consulta al usuario: desactivar una cuenta o cambiar su rol la saca al instante. Cambiar la clave cierra las demás sesiones.
- **Bitácora inmutable.** Registra entradas, intentos fallidos, lectura y escritura de historias. Un disparador de PostgreSQL impide modificarla, y nunca guarda contenido clínico.
- **Ley 1581 de 2012.** Sin autorización no se reserva, y queda la prueba: fecha, versión de la política, canal e IP. El derecho de supresión borra los datos personales y conserva la historia clínica sin identificar a nadie. La política de la demo es un ejemplo: un negocio real debe revisarla con un abogado.
- **Sin ruta pública para crear cuentas.** La primera se crea desde la consola:
  ```bash
  ADMIN_EMAIL=correo@negocio.co ADMIN_PASSWORD='una-clave-larga' npm run crear-admin
  ```
- **Login sin pistas:** el mismo mensaje y un tiempo parecido exista o no el correo.
- **Dos límites de intentos:** por IP y por cuenta. El de cuenta no depende de la IP, así que resiste aunque el atacante la cambie.
- **`TRUST_PROXY`:** debe ser igual al número de proxies delante de la API; en esta demo son 4 (Vercel, Cloudflare, balanceador y proxy de Render). Con un número menor la API confunde la IP de Vercel con la del visitante. Riesgo conocido: quien llame directo a Render puede falsear la IP; con dominio propio se cierra ese acceso, y el límite por cuenta protege el login en cualquier caso.
- Contraseñas con bcrypt, validación de todos los campos, encabezados con helmet y CSP en la web.
- **Modo demo (`MODO_DEMO=true`):** las cuentas no se pueden cambiar, para que la demo pública siga funcionando.

## Operación

Ruta de salud, registros en JSON con id de petición, apagado ordenado y copias de seguridad cifradas cada semana, con la restauración probada en CI. Todo está en [docs/operacion.md](docs/operacion.md).

## Calidad

- **ESLint** (`npm run lint`) y pruebas en cada push y PR (GitHub Actions).
- **Dependabot** revisa dependencias cada semana; las menores llegan juntas en un PR.
- **Prisma 6**: Prisma 7 cambia el cliente (adaptadores de base de datos y módulos ES), así que se migrará a propósito en un cambio aparte, no con una actualización automática.
- **Cada módulo en su carpeta** (`citas/`, `clientes/`, `avisos/`, `mensajes/`, `ajustes/`, `reportes/`, `seguridad/`, `bot/`, `plataforma/`); `app.js` solo los une.

## Pruebas

162 pruebas con Jest y Supertest contra una base de datos PostgreSQL real (`huellitas_test`): agenda (festivos de 2026, horarios, cruces, reservas simultáneas, estados), clientes y mascotas, historia clínica, vacunas, enlace del cliente, correos, recordatorios, sesión, roles, bitácora, Ley 1581, datos de la demo, formulario, login, panel, seguridad, conversación completa del bot, fechas escritas en el chat, urgencias, IA (simulada) y webhook firmado. Corren solas en GitHub Actions en cada cambio.

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
