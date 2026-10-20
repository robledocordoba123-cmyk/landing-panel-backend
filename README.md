# Huellitas Veterinaria · API (backend)

API REST de la landing de Huellitas Veterinaria (negocio **ficticio**, proyecto de portafolio): recibe las solicitudes de cita del formulario público y las entrega a un panel privado con login.

## Tecnologías

Node.js · Express 5 · PostgreSQL · Prisma · JWT · bcrypt · helmet · express-rate-limit

## Endpoints

| Método | Ruta | Descripción | Protegido |
|---|---|---|---|
| POST | `/api/mensajes` | Guarda una solicitud de cita (con validación y límite de envíos) | No |
| GET | `/api/mensajes?estado=NUEVO\|ATENDIDO` | Lista las solicitudes y el conteo por estado | Sí |
| PATCH | `/api/mensajes/:id` | Marca una solicitud como atendida o la devuelve a nueva | Sí |
| POST | `/api/login` | Inicia sesión y devuelve un token (máximo 10 intentos fallidos cada 15 min) | No |

## Asistente de WhatsApp

Bot que atiende a los clientes por WhatsApp (`bot/`):

- Menú con servicios y precios, horarios y ubicación, **agendar cita** (pide nombre, mascota, servicio y correo, con validación) y **hablar con una persona**.
- Detecta urgencias ("envenenó", "no respira"…) y avisa al equipo de inmediato.
- Las citas, urgencias y pedidos de atención humana se guardan como solicitudes con `origen = WHATSAPP` y aparecen en el panel.
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

20 pruebas con Jest y Supertest contra una base de datos PostgreSQL real (`huellitas_test`): formulario, login, panel, seguridad, conversación completa del bot, validaciones, urgencias, IA (simulada) y webhook de WhatsApp (verificación, firma falsa y envío de la respuesta).

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

## Frontend

[landing-panel-frontend](https://github.com/robledocordoba123-cmyk/landing-panel-frontend)

---
Diseño y desarrollo: Manuela Córdoba Robledo.
