# Decisiones de diseño

Cada decisión con el problema que resolvía, lo que se eligió, lo que se descartó y su costo. Están en el orden en que se tomaron.

---

### 1. Que la base de datos impida las citas cruzadas

- **Problema:** dos personas reservan la misma hora al mismo tiempo. Si primero se consulta y luego se guarda, entre los dos pasos la otra persona puede ganar.
- **Decisión:** restricción `EXCLUDE USING gist` sobre `(recurso, rango de tiempo)` con `btree_gist`. La base rechaza la segunda cita y la API responde 409 con un mensaje claro.
- **Descartado:** bloquear la tabla o revisar en el código. Lo primero frena a todos; lo segundo falla justo en el caso que importa.
- **Costo:** una migración en SQL escrito a mano, porque Prisma no modela esta restricción. Una prueba hace 8 reservas simultáneas y solo una gana.

### 2. Fechas en UTC y reglas en hora de Colombia

- **Decisión:** guardar en UTC y calcular en UTC−5. Colombia no cambia de hora, así que el desfase es fijo. Los festivos se calculan por año (Semana Santa y Ley Emiliani), sin depender de una lista que haya que actualizar.
- **Costo:** las funciones de fecha deben recibir siempre la fecha local como texto `AAAA-MM-DD`; nunca se usa la zona del servidor.

### 3. Una sola lógica para la página, el panel y WhatsApp

- **Decisión:** las reglas de la agenda viven en `citas/agenda.js` y todos los canales las llaman.
- **Por qué:** si el asistente de WhatsApp tuviera su propia validación, tarde o temprano dejaría reservar algo que la página no permite.

### 4. Sesión en cookie httpOnly, a través de Vercel

- **Problema:** el token en `localStorage` lo puede leer cualquier script inyectado.
- **Decisión:** cookie `httpOnly`, `Secure` y `SameSite=Strict`. Para que sea del mismo sitio, Vercel reenvía `/api` a Render.
- **Costo:** detrás de varios proxies, Express no ve la IP real sin `TRUST_PROXY` correcto (4: tres de Render y uno de Vercel). Se comprobó con `/api/diagnostico/red`. Además hay un límite por cuenta que no depende de la IP.

### 5. Los permisos se deciden en la API

- **Decisión:** `exigirRol` en cada ruta. Recepción ni siquiera recibe la historia clínica.
- **Descartado:** ocultar botones en la pantalla. Eso es diseño, no seguridad: cualquiera puede llamar a la API directamente.
- **Detalle:** cada sesión lleva una `sesionVersion`, así que cambiar el rol o desactivar a alguien lo saca de inmediato, sin esperar a que el token venza.

### 6. Bitácora que ni la propia aplicación puede borrar

- **Decisión:** tabla `Bitacora` con un trigger que rechaza `UPDATE` y `DELETE`. Registra quién abrió cada historia clínica, sin guardar su contenido.
- **Por qué:** si el código pudiera borrarla, un error o un acceso indebido también podría hacerlo.

### 7. Ley 1581: autorización con prueba y supresión real

- **Decisión:** sin autorización no se reserva. Cada autorización guarda la versión de la política, el canal y la IP. Suprimir borra los datos personales y conserva la historia clínica sin identificar a nadie.
- **Límite:** la política es un ejemplo; un negocio real debe revisarla con un abogado.

### 8. Correos opcionales y simulados por defecto

- **Decisión:** sin `BREVO_API_KEY` los correos quedan registrados como simulados.
- **Por qué:** la demo es pública. Con envío real, cualquiera podría escribir un correo ajeno y usar la API para enviarle mensajes.

### 9. Enlace firmado para que el cliente gestione su cita

- **Decisión:** `id.firma` con HMAC, sin cuenta ni contraseña. La firma se compara en tiempo constante.
- **Costo:** quien tenga el enlace puede cancelar esa cita. Es el mismo modelo que usan las aerolíneas con su código de reserva.

### 10. Horario y servicios en la base de datos

- **Decisión:** tablas `Jornada` y `Cierre`. Los servicios se ocultan en vez de borrarse, porque hay citas que los usan.
- **Regla clave:** un cambio que deje por fuera citas ya reservadas se rechaza y dice cuáles son. El negocio decide qué hacer con esas citas; el sistema no las cancela solo.
- **Costo:** cada búsqueda de horarios consulta el calendario. Se guarda un minuto en memoria y se limpia al cambiarlo.

### 11. Registros útiles sin datos personales

- **Decisión:** una línea JSON por petición, con id, ruta, estado y duración. Nunca cuerpos ni búsquedas, y el enlace de "Mi cita" se oculta. De los errores de Prisma se guarda solo el tipo y el código, porque su mensaje puede repetir datos.
- **Por qué:** un registro no debe convertirse en otra copia de los datos de los clientes.

### 12. Copias cifradas y restauración probada

- **Decisión:** copia semanal con `pg_dump`, cifrada con AES-256 antes de guardarse como artefacto de GitHub. CI restaura una copia en cada cambio y compara datos, restricciones y trigger.
- **Por qué:** los artefactos de un repositorio público los puede descargar cualquiera. Y una copia que nunca se ha restaurado no es una copia.

### 13. Prisma 6 y no Prisma 7, por ahora

- **Decisión:** actualizar a la última versión 6.
- **Por qué:** Prisma 7 cambia la forma de conectarse (adaptadores de base de datos) y el tipo de módulos (ES). Es una migración que conviene hacer sola, con sus propias pruebas, no metida en una actualización automática. Dependabot tiene esa versión excluida.

### 14. La demo pública se restablece sola

- **Decisión:** cada arranque recarga los datos de ejemplo, el horario y los servicios originales, más ocho semanas de historial.
- **Por qué:** cualquiera puede entrar como administración. Sin esto, un visitante podría dejar la veterinaria cerrada para el siguiente.

### 15. Pruebas en tres capas

- **API:** reglas y permisos contra PostgreSQL real, porque las restricciones y los triggers no existen en una base simulada.
- **Pantallas:** cada flujo con respuestas falsas de la API; son rápidas y señalan exactamente qué se rompió.
- **De punta a punta:** un navegador real contra la API real, en computador y celular, con revisión de accesibilidad (axe). Son pocas a propósito: son las más lentas y frágiles.
