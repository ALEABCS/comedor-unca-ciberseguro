# Comedor Universitario UNCA

Plataforma web institucional para consultar menús, gestionar reservas y tickets QR, registrar consumos, reportar incidentes y consultar información operativa del Comedor Universitario de la Universidad Nacional de Catamarca.

> **Estado de esta entrega:** además de Google OAuth, existe registro e inicio de sesión local por DNI/usuario con contraseña hasheada, perfil editable, tarifas versionadas, solicitudes y revisión de becas, referencias manuales de pago y pantallas de administración protegidas por rol. Las reservas conservan el importe/rol al momento de crearse; los tickets se habilitan al confirmar el pago y registran intentos de uso. En el entorno local validado se comprobó Google OAuth, conexión a XAMPP/MariaDB y aplicación de las migraciones; antes de cada instalación se deben repetir las comprobaciones. No se integra una pasarela de pagos ni Google Calendar.

## Requisitos

- Node.js 20.19+ o 22.12+ y npm.
- MySQL 8.0+ o el servidor compatible MariaDB incluido con XAMPP, con una cuenta autorizada para crear base y tablas. En el equipo validado, XAMPP ejecuta MariaDB 10.4.32.
- Credenciales OAuth 2.0 de Google para iniciar sesión fuera del modo DEMO.

## Instalación local (PowerShell)

```powershell
npm install
Copy-Item .env.example .env
```

Editar `.env` con la URL de MySQL, el dominio local y los secretos. `DATABASE_URL` es la fuente inicial de conexión; si se configuran `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` o `DB_NAME`, esos campos individuales prevalecen.

Crear y preparar la base de datos:

```powershell
npm run db:migrate
npm run db:seed
```

Para modo demostración local, establecer `DEMO_MODE=true` en `.env` antes de iniciar `db:seed`. El modo DEMO crea seis cuentas ficticias para acceso rápido por rol, dos cuentas administrativas con usuario y contraseña, y menús de muestra. Las contraseñas de las cuentas administrativas se guardan como hashes. No habilitarlo en producción. En modo normal no se crean cuentas ni menús de prueba.

El acceso local permite registrar cuentas de usuario final con DNI y contraseña. Los roles administrativos no se seleccionan durante el registro; solo un Supervisor puede asignarlos desde Usuarios. Google OAuth permanece disponible en paralelo.

Iniciar la interfaz y el servidor:

```powershell
npm run dev
```

Vite sirve el cliente en `https://localhost:5173` con un certificado local autofirmado y Express atiende la API en `http://localhost:4000`; el proxy de Vite conserva la comunicación del cliente con la API. La primera vez, el navegador puede mostrar una advertencia de certificado: es el certificado local no confiable de desarrollo, no un certificado para producción. Al iniciar el entorno, Vite abre el cliente en el navegador predeterminado; el acceso de Google se abre en otra pestaña para completar OAuth fuera de navegadores integrados. La ruta `/api/health` permite comprobar conexión con MySQL.

### Abrir desde un celular en la red local

1. Iniciá el entorno con `npm run dev`, conectá el celular a la misma Wi-Fi y abrí la aplicación en la computadora.
2. Tocá **Generar QR** en la pantalla de acceso. El QR se crea o actualiza en ese momento con la dirección LAN detectada; escanealo desde el celular. No uses `localhost` en el celular: allí señalaría al propio teléfono.
3. Si la dirección no responde, ejecutá `ipconfig` para comprobar la IPv4 del adaptador Wi-Fi activo, confirmá que ambos dispositivos estén en la misma red y permití el acceso al puerto 5173 desde la subred local en Windows Defender Firewall. No expongas estos puertos a redes públicas.

En producción, el QR usa el origen configurado en `APP_URL`. Cuando se asigne el dominio institucional, configurá `APP_URL=https://<dominio-institucional>` y `GOOGLE_CALLBACK_URL=https://<dominio-institucional>/auth/google/callback`, con proxy HTTPS hacia el servidor Node. El QR no usa la IP local en producción. Los QR de tickets/reservas conservan su contenido firmado y no son enlaces de acceso al portal.

## Google OAuth

Crear un cliente OAuth tipo aplicación web en Google Cloud y registrar exactamente el callback configurado. Para desarrollo local, la configuración usa localhost; Google OAuth desde un celular en la red LAN requiere cambiar temporalmente `APP_URL` y `GOOGLE_CALLBACK_URL` a la IP local y registrar ese callback en Google Cloud. Completar:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback
```

La aplicación valida que Google haya verificado el correo. Una identidad nueva recibe el rol mínimo `ALUMNO`; nunca se aceptan roles enviados por el navegador. La asignación de roles administrativos solo está disponible para un Supervisor autenticado.

## Variables de entorno

| Variable | Uso |
|---|---|
| `NODE_ENV` | `development`, `test` o `production`. |
| `PORT` | Puerto de Express (4000 por defecto). |
| `APP_URL` | Origen permitido de la interfaz y destino del callback. |
| `DATABASE_URL` | URL MySQL opcional; p. ej. `mysql://usuario:clave@127.0.0.1:3306/basecomedorunca2026`. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión XAMPP/MySQL; las variables individuales prevalecen sobre la URL. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | OpenID/OAuth de Google. |
| `SESSION_SECRET` | Clave para firmar la cookie de sesión; 32 caracteres aleatorios o más en producción. |
| `QR_SIGNING_SECRET` | Clave distinta para firmar QR; 32 caracteres aleatorios o más en producción. |
| `TOTP_ENCRYPTION_SECRET` | Clave para cifrar factores TOTP y firmar los hashes de recuperación; 32 caracteres aleatorios o más. |
| `DEMO_MODE` | Habilita acceso ficticio únicamente en entornos que no sean producción. |

Generar los tres secretos con un generador criptográfico seguro; deben tener al menos 32 caracteres, ser diferentes y no conservarse vacíos ni con valores de ejemplo. La aplicación no utiliza secretos de fallback, tampoco en desarrollo. Conservá `TOTP_ENCRYPTION_SECRET` en un respaldo privado: perderlo impide descifrar los factores registrados. No reutilizar secretos de desarrollo en producción. No subir `.env`.

## Observabilidad y mantenimiento

La API expone rutas de salud y versión sin revelar secretos ni datos sensibles:

- `GET /health`: verifica conexión con la base y devuelve `status` + `database`.
- `GET /ready`: agrega `ready`, `environment` y `version` para orquestación y despliegue.
- `GET /version`: devuelve el nombre y versión de la aplicación junto con los feature flags activos.
- `GET /api/health`: alias compatible con la entrega actual para validaciones existentes.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Arranca Vite y Express para desarrollo. |
| `npm run build` | Comprueba TypeScript y genera cliente de producción en `dist/`. |
| `npm start` | Ejecuta el servidor Express compilado para producción. |
| `npm run typecheck` | Comprueba los tipos TypeScript. |
| `npm test` | Ejecuta las pruebas unitarias. |
| `npm run db:migrate` | Crea la base si hace falta y aplica migraciones Drizzle tras validar el estado existente. |
| `npm run db:copy-legacy` | Copia datos desde `LEGACY_DB_NAME` a `TARGET_DB_NAME` solo si el destino está vacío y el esquema es compatible. |
| `npm run db:seed` | Inserta datos iniciales faltantes sin borrar asignaciones existentes; usuarios/menús ficticios solo en DEMO. |
| `npm run db:generate` | Genera migraciones Drizzle a partir de `server/db/schema.ts`. |
| `npm run db:repair-finance` | Completa la migración financiera `0022` únicamente tras validar `FINANCE_BACKUP_PATH`, `FINANCE_BACKUP_SHA256` y el estado parcial esperado. No usar como migrador general. |

## Módulo financiero

La ruta `/finanzas` amplía, sin reemplazar `/pagos`, el flujo manual de conciliación, acreditación, imputaciones por reserva, caja y recibos. Los comprobantes no acreditan fondos por sí solos: personal autorizado verifica la documentación y un responsable registra el importe acreditado y la referencia institucional. Las diferencias quedan pendientes y no se imputan. El circuito, permisos, instalación y recuperación están en [`docs/finance.md`](./docs/finance.md).

## Reloj y clima

El shell muestra fecha y hora del reloj del dispositivo en `America/Argentina/Catamarca`, y clima de Open-Meteo para San Fernando del Valle de Catamarca. La localidad se puede cambiar desde el selector y se guarda en el navegador. El clima se consulta cada 10 minutos mediante `/api/weather`; el servidor limita consultas y conserva una caché de cinco minutos que la interfaz identifica como tal, junto con la hora de observación y consulta. No requiere clave API ni presenta una lectura anterior como actual cuando el proveedor falla.

La migración financiera crea tablas complementarias y no recalcula ni cambia reservas existentes. Antes de aplicarla, se requiere un respaldo verificado. Para instalaciones que comenzaron la migración con `0022` y quedaron parciales en MariaDB 10.4, solo se debe usar el reparador documentado, con `FINANCE_BACKUP_PATH` y `FINANCE_BACKUP_SHA256` del respaldo validado.

[`database/comedor_unca.sql`](./database/comedor_unca.sql) es un esquema completo para instalación manual en `basecomedorunca2026`. Para actualizaciones versionadas, usar `npm run db:migrate`; no ejecutar ambas rutas de instalación sobre la misma base sin revisar previamente su estado. La instalación SQL usa `CREATE ... IF NOT EXISTS`/`INSERT IGNORE` y no borra tablas ni reemplaza datos.

### MySQL local con XAMPP (Windows)

1. Abrí el panel de XAMPP e **iniciá MySQL manualmente**. El proyecto no inicia ni detiene servicios del sistema.
2. Confirmá el puerto en `C:\xampp\mysql\bin\my.ini`. En este equipo se detectó MariaDB 10.4.32 de XAMPP en `127.0.0.1:3306`; si tu configuración difiere, usá el puerto de tu instalación.
3. En `.env`, configurá `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=basecomedorunca2026` y las credenciales que realmente utiliza tu XAMPP. No se presupone usuario `root` ni contraseña vacía. También podés usar solo `DATABASE_URL`.
4. La migración crea la base únicamente cuando falta. Si encuentra tablas sin historial Drizzle, solo adopta automáticamente una base que coincida estructuralmente con la línea base histórica `0003_robust_runaways`; en ese caso registra el historial sin alterar esas tablas y continúa con las migraciones pendientes. Ante cualquier diferencia, aborta sin migrar.
5. Con MySQL iniciado y usuario configurado, ejecutá `npm run db:migrate` y luego `npm run db:seed`. Si el servidor no está escuchando, la conexión falla explícitamente.

El seed inserta roles, permisos, asignaciones y configuración solo cuando faltan. Las cuentas DEMO se crean solo con `DEMO_MODE=true` fuera de producción y las inserciones usan `INSERT IGNORE`: no sobrescriben cuentas existentes. Para iniciar sesión con contraseña en el entorno local DEMO:

| Usuario | Contraseña | Rol |
|---|---|---|
| `comedor` | `comedor123` | Administrador local |
| `supervisor` | `supervisor123` | Supervisor |

Un conflicto de identificador/correo en las cuentas DEMO de acceso rápido por rol detiene y revierte el seed; no modifica el usuario existente.

## Roles y seguridad

Los seis roles están definidos en [`docs/roles.md`](./docs/roles.md). Las pantallas filtran navegación para orientar la experiencia; **la API vuelve a autorizar cada operación en el servidor**. El panel adicional `/defensa` reutiliza el centro de seguridad existente y está disponible solo para Supervisor, con la bandera `ULTIX_DEFENSA` habilitada. Para detalles de sesiones, reservas transaccionales, QR anti-replay, privacidad y límites de seguridad, consultar [`docs/security.md`](./docs/security.md).

Las cuentas nuevas, sean registradas localmente, por Google o creadas por personal, permanecen pendientes hasta que un Supervisor valide manualmente identidad y rol con una fuente institucional autorizada. El sistema no comprueba dominios de correo ni un padrón de UNCA. Las cuentas activas anteriores se conservan para no interrumpir el servicio y requieren una decisión separada si se quiere revisar retroactivamente.

El menú “Sesiones activas” muestra el dispositivo, última actividad, vencimiento e IP parcialmente anonimizada. El usuario puede revocar una sesión propia o cerrar las demás; cada revocación queda auditada. La aplicación también es instalable como PWA en navegadores compatibles. El service worker almacena únicamente recursos estáticos y una página genérica sin conexión; no guarda respuestas de API ni permite reservar, pagar o validar tickets offline.

Las reservas tienen límite semanal de cinco y capacidad, ventana de reserva y horario límite configurables en MySQL. Una transacción bloquea el usuario y el cupo, reserva el número en orden de solicitud, conserva precio/rol/DNI al momento y registra notificación/auditoría. El número queda protegido por un índice único y no se reutiliza al cancelar; el ticket y el QR se emiten cuando la reserva está aprobada y el pago resuelto. El índice único también impide duplicar una reserva de usuario para el mismo servicio y fecha; una cancelación libera el cupo transaccionalmente. Las reservas con importe requieren una referencia externa y revisión autorizada antes de habilitar el QR. La validación bloquea el ticket, registra el escaneo y cambia ticket/reserva a utilizados en una única transacción; un segundo uso se rechaza.

Las nuevas reservas quedan pendientes de aprobación del Administrador local o Supervisor; ambos también pueden aprobar o rechazar los pagos informados. El QR solo se habilita cuando la reserva está aprobada y el pago correspondiente está confirmado. La migración añade una aprobación histórica a reservas que ya estaban confirmadas, pagadas o utilizadas para conservar su disponibilidad previa. El Supervisor administra beneficios, becas y tarifas; la asignación de un beneficio se audita, pero no cambia automáticamente el precio. El menú es administrado exclusivamente por el Administrador local.

El catálogo de alimentos y el constructor estructurado de menús también son exclusivos del Administrador local (`menu:manage`). La migración `0011_fresh_selene` agrega tablas sin reemplazar las tablas o reservas existentes; `npm run db:seed` conserva los 202 alimentos base existentes y agrega 500 platos preparados de manera idempotente. La migración `0018_fuzzy_korath` crea la tabla especializada `comidas`; [database/comidas_500.sql](./database/comidas_500.sql) también permite instalar el dataset en phpMyAdmin con `CREATE TABLE IF NOT EXISTS` e `INSERT IGNORE`. Nutrientes, costos y tiempos son orientativos: deben validarse con recetas institucionales, fichas de proveedores y precios vigentes antes de publicarlos. Los alérgenos, las propiedades sin TACC/veganas y los valores nutricionales de alimentos base no se infieren: quedan sin verificar o vacíos hasta que el comedor los confirme. La desactivación es lógica y los menús guardan snapshots para conservar su lectura histórica.

El constructor permite generar borradores de menú para un día, siete días o un período de 30 días. El porcentaje de comidas nutricionales (80% inicial) se guarda en configuración; el planificador distribuye almuerzos y cenas, alterna fuentes de proteína y métodos de cocción, evita reutilizar platos y conserva los servicios que ya tienen menú. Los borradores requieren revisión y publicación explícita del Administrador local. El detalle de campos, consultas de validación y la vista previa semanal están en [docs/comidas-500.md](./docs/comidas-500.md).

El informe de usuarios permite consultar perfiles y vigencia de becas con filtros por período, rol y estado, y exportar resultados a CSV/XLSX o imprimirlos. Los cierres excepcionales de servicio impiden nuevas reservas en una fecha laborable concreta sin modificar reservas históricas. La migración `0024_peaceful_sugar_man` agrega esa tabla y solo cambia la ventana inicial de reserva de cena cuando conserva exactamente el valor anterior por defecto; no configura el horario físico de atención, que queda pendiente de confirmación institucional.

Las reservas confirmadas, aprobadas y con pago resuelto que vencen sin consumo se registran como no-show para reportes; esta marca no aplica sanciones ni modifica elegibilidad automáticamente.

Cuando un servicio está completo durante la ventana de reserva, una persona elegible puede anotarse en la lista de espera, que respeta el orden de llegada. Al liberarse un cupo antes del límite de presentación, el servidor crea una oferta exclusiva y una notificación dentro de la aplicación; hay 60 minutos para confirmar, o hasta ese límite si ocurre antes. El cupo se retiene durante la oferta para impedir sobre-reservas; al vencer, cancelar o confirmar, el siguiente usuario elegible se procesa transaccionalmente. Una reserva puede cancelarse hasta el cierre configurado de reservas para ese servicio en su fecha; pasada esa hora, la API rechaza la cancelación. Un no-show posterior al horario límite libera el contador, pero no genera una oferta tardía para una comida ya vencida. Los no-show se conservan solo como estadística, sin sanciones ni bloqueos automáticos.

El panel operativo ofrece informes diarios, semanales, mensuales y anuales basados en MySQL, ocupación/cupos, consumos y no-show, con exportación CSV protegida contra fórmulas de hoja de cálculo. Una reserva confirmada, aprobada y con pago resuelto se marca no-show al vencer sin consumo; esa estadística no aplica sanciones. El módulo Cocina muestra el menú, reservas que cumplen esas condiciones, tickets consumidos y raciones producidas/observaciones registradas por el personal autorizado. No calcula inversión, subsidios ni ganancias: el sistema todavía no tiene un origen verificado de costos para esas métricas.

La numeración es secuencial por fecha y servicio, respeta el orden de creación de la reserva y no se reutiliza si se cancela o rechaza; el ticket se emite al aprobar la reserva y resolver su pago, conservando el número previamente reservado. Las solicitudes pendientes pueden dejar huecos en la numeración visible. El Administrador local puede consultar una vista previa antes de imprimir un talón por cada ticket disponible de una fecha y servicio, con turno, identificador, nombre del estudiante y la indicación para presentarlo en cocina; la operación queda auditada y no incluye tickets usados, cancelados ni vencidos. Los QR contienen un UUID firmado con HMAC, no datos personales ni secretos; la firma se verifica en servidor y solo se consume en la fecha asignada.

## Estructura

```text
client/src/           Interfaz React, rutas y estilos
public/branding/      Identidad UNCA/Comedor, iconos PWA y fotografías optimizadas
server/auth/          OAuth y serialización de identidad
server/domain/        Reglas de negocio transaccionales
server/db/            Pool MySQL, Drizzle, esquema, migración y seed
server/routers/       API tRPC, validación y autorización
server/security/      Firma y validación del QR
shared/               Roles, permisos y funciones de dominio comunes
database/             SQL de instalación reproducible
tests/                Pruebas unitarias
docs/                 Matriz de permisos y notas de seguridad
```

El inventario y la asignación de los activos visuales institucionales están documentados en [docs/branding-assets.md](./docs/branding-assets.md). Los originales proporcionados se conservan en `public/branding/originals/`.

## Pruebas y verificación

```powershell
npm test
npm run typecheck
npm run build
```

Las pruebas automatizadas cubren reglas de calendario/cupo, RBAC, firma del QR y autenticación TOTP. Para validar concurrencia real (último cupo), persistencia MySQL, OAuth y anti-replay extremo a extremo, hace falta configurar una instancia MySQL de pruebas y credenciales OAuth. Los backups de entrega deben excluir `.env`, imágenes/datos privados, `node_modules` y archivos generados.

## Producción y operación

Para preparar un traslado desde el ZIP, seguir [docs/despliegue-portable.md](./docs/despliegue-portable.md). El paquete excluye credenciales y dependencias nativas instaladas; cada servidor debe recibir sus propios secretos, ejecutar `npm ci` y configurar su propia base MySQL.

1. Servir la aplicación bajo HTTPS y fijar `APP_URL`/`GOOGLE_CALLBACK_URL` al dominio final.
2. Proporcionar una base MySQL 8 dedicada, aplicar migraciones y configurar backups cifrados con una política de restauración probada.
3. Configurar secretos distintos por entorno en un almacén seguro; mantener `DEMO_MODE=false`.
4. Ejecutar `npm run build`, desplegar el cliente `dist/` y el proceso Node con `NODE_ENV=production`.
5. El proxy inverso debe establecer correctamente `X-Forwarded-Proto`; Express confía en un proxy en producción para cookies `Secure`.
6. Revisar permisos del usuario técnico de MySQL, política institucional de elegibilidad y retención, y monitoreo de logs antes de abrir el acceso.

El medio de pago seleccionado es [BNA+](https://www.bna.com.ar/Personas/BNAmas), en modalidad manual: el usuario presenta una referencia y personal autorizado verifica el pago dentro del canal institucional antes de aprobarlo. No se integran credenciales financieras ni se automatiza la confirmación; la información pública de BNA+ describe pagos QR en la billetera, pero no aporta una API pública de comercio/webhooks. Una automatización futura requiere convenio y documentación técnica oficial de BNA. La pantalla Operación permite escanear tickets QR con una cámara compatible del navegador y conserva la entrada manual/lector conectado como alternativa; el navegador requiere permiso de cámara y un contexto seguro (HTTPS o localhost). No incluye carga de documentación personal de becas, entrega real de correo/push ni integración automática con Google Calendar. La verificación de pertenencia institucional, caja e inventario requieren definición/configuración institucional antes de considerarse operativos.
