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

## Seguridad

- Las contraseñas se guardan cifradas con bcrypt y el panel usa tokens JWT de 8 horas.
- **Ya no existe una ruta pública para crear administradores.** La cuenta del panel se crea solo desde la consola del servidor:
  ```bash
  ADMIN_EMAIL=correo@negocio.co ADMIN_PASSWORD='una-clave-larga' npm run crear-admin
  ```
- Validación de todos los campos, límite de envíos del formulario, encabezados de seguridad con helmet y CORS solo para el frontend configurado.

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
