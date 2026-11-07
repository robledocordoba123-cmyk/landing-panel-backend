# Operación de Huellitas

Qué mirar cuando algo falla y cómo recuperar los datos.

## ¿Está funcionando?

`GET /api/salud` responde `200` si la API llega a la base de datos y `503` si no. La raíz `/` solo dice que el proceso está vivo. El campo `version` es el commit publicado.

## Registros

Cada petición deja una línea JSON en los registros de Render, con ruta, estado, duración e id. Quien vea un error en pantalla recibe ese id en la cabecera `X-Request-Id` (y en el cuerpo si fue un error 500): con él se encuentra la petición exacta.

Los registros no guardan cuerpos ni parámetros de búsqueda, y el enlace de "Mi cita" se oculta. De los errores de Prisma solo se guarda el tipo y el código, porque su mensaje puede repetir datos personales.

## Copias de seguridad

Cada domingo, GitHub Actions saca una copia, la cifra con AES-256 y la guarda 30 días como artefacto. Los artefactos de un repositorio público los puede descargar cualquier cuenta de GitHub: por eso la copia sale cifrada y la clave nunca se guarda en el repositorio.

- **Perder como máximo:** una semana de datos. Neon guarda además su propio historial de restauración, más corto.
- **Secretos del repositorio:** `BD_COPIA_URL` (conexión directa, sin `-pooler`) y `CLAVE_COPIA`.
- **La clave se guarda aparte, en un gestor de contraseñas.** Sin ella, las copias no se pueden abrir.
- **GitHub pausa las tareas programadas** tras 60 días sin actividad en el repositorio. Si eso pasa, avisa por correo y se reactiva en la pestaña Actions.
- **Cada cambio se prueba:** CI hace el ciclo completo con `scripts/probar-copia.sh` y compara datos, restricción de cruces y trigger de la bitácora.

### Restaurar una copia

1. En Actions, abre la última ejecución de **Copia de seguridad** y descarga el artefacto.
2. Crea una base vacía. Nunca restaures sobre la base en uso: el script se niega si ya tiene tablas.
3. Corre, en una máquina con `pg_restore` y `gpg`:

   ```bash
   BD_DESTINO_URL='postgresql://...' CLAVE_COPIA='...' scripts/restaurar-copia.sh huellitas-AAAAMMDD.dump.gpg
   ```

4. Revisa los datos, cambia `DATABASE_URL` en Render a la base nueva y comprueba `/api/salud`.

Si alguien pidió suprimir sus datos después de la fecha de la copia, hay que volver a suprimirlos al restaurar: la bitácora (`DATOS_SUPRIMIDOS`) dice cuáles.
