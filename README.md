# Landing Panel Backend

API REST construida con Node.js y Express, con autenticación JWT, para gestionar los mensajes de contacto de una landing page y proteger el acceso al panel de administración.

## Tecnologías utilizadas

- Node.js + Express
- PostgreSQL
- Prisma ORM
- JWT (JSON Web Tokens) para autenticación
- bcrypt para encriptar contraseñas
- CORS

## Funcionalidades

- Endpoint para guardar mensajes del formulario de contacto
- Endpoint para listar mensajes (protegido, requiere autenticación)
- Registro de usuario administrador
- Login con generación de token JWT
- Middleware de verificación de token para proteger rutas

## Endpoints principales

| Método | Ruta | Descripción | Protegido |
|--------|------|-------------|-----------|
| POST | /api/mensajes | Guarda un mensaje del formulario | No |
| GET | /api/mensajes | Lista todos los mensajes | Sí |
| POST | /api/registro | Crea un usuario administrador | No |
| POST | /api/login | Inicia sesión y devuelve un token | No |

## Frontend relacionado

Este backend es consumido por el frontend disponible en:
https://github.com/robledocordoba123-cmyk/landing-panel-frontend
