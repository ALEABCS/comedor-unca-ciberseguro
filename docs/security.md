# Seguridad y límites conocidos

## Identidad y sesiones

- Inicio de sesión mediante Passport Google OAuth 2.0 con el parámetro `state` y correo verificado. El inicio se canonicaliza al host de `APP_URL` antes de emitir el estado; `APP_URL` y `GOOGLE_CALLBACK_URL` deben compartir hostname para que la cookie de sesión llegue al callback.
- El servidor asocia la identidad Google a un usuario por subject; el cliente nunca envía el rol como dato de autenticación.
- Sesiones Passport persistidas en MySQL, cookie `HttpOnly`, `SameSite=Lax`, expiración de 12 horas y `Secure` en producción.
- `SESSION_SECRET` y `QR_SIGNING_SECRET` se validan en todos los entornos: deben tener al menos 32 caracteres, ser distintos y no usar valores de ejemplo. No hay secretos fallback incorporados en el código.
- Cada respuesta tiene un `X-Request-ID`; los errores de servidor y tRPC devuelven ese identificador para correlacionar el mensaje del usuario con el log estructurado. Los stack traces se omiten también en desarrollo.
- Cierre de sesión invalida la sesión de servidor y elimina la cookie.
- La pantalla de sesiones lista únicamente las sesiones Passport del usuario autenticado, permite revocar una sesión ajena a la actual o cerrar las demás, y registra las revocaciones en auditoría. Se guarda el agente de usuario y una IP truncada; no se realiza geolocalización.
- Límites de intentos para rutas OAuth y demo mediante `express-rate-limit`.
- Los rechazos del inicio de sesión local se registran en `audit_logs` sin guardar contraseña ni identificador de acceso. Los fallos MFA ya registrados se incluyen en el contador del centro de seguridad. El feed oculta identidad y motivo de los eventos fallidos; los rechazos gestionados externamente por Google no se contabilizan.
- Las cuentas nuevas por registro local o creación administrativa quedan en estado `PENDING` y no reciben sesión hasta su revisión. Una identidad nueva de Google se crea como `INVITADO_ESPECIAL`/`PENDING`: puede entrar con permisos de invitado, pero no crear/cancelar reservas ni operar la lista de espera hasta que un Administrador Local o Supervisor la apruebe y asigne un rol. Las identidades Google heredadas `ALUMNO`/`PENDING` se convierten a Invitado al autenticarse de nuevo solo si coincide el Google Subject; el cambio queda auditado y no afecta cuentas activas ni roles ya revisados. El Administrador Local solo asigna roles ordinarios; el Supervisor puede asignar todos. Google verifica el control del correo, pero no la pertenencia institucional ni el dominio. Las cuentas activas previas se conservan sin cambios y no se consideran verificadas retroactivamente por esta política.
- Las cuentas `ADMINISTRADOR_LOCAL` y `SUPERVISOR` deben completar TOTP antes de obtener acceso operativo, tanto con acceso local como con Google OAuth. El código TOTP usado no puede repetirse en otro inicio de sesión.
- La asignación automática por Google se limita a los correos verificados explícitamente aprobados en `server/auth/google-account.ts`; las cuentas suspendidas no se reactivan. Cada alta privilegiada o cambio de rol por esta excepción queda auditado.
- El secreto TOTP se cifra con AES-256-GCM usando `TOTP_ENCRYPTION_SECRET`; los códigos de recuperación se guardan como HMAC y cada uno se consume una sola vez. La clave de cifrado debe conservarse en privado y respaldarse; si se pierde, los secretos TOTP no se pueden recuperar.
- Los usuarios privilegiados con sesiones anteriores deben verificar su segundo factor; una sesión preexistente no se considera verificada por activar TOTP en la cuenta.
- El modo de demo no está disponible en `NODE_ENV=production`.

## Autorización y entrada

- Procedures privados requieren usuario activo, excepto el acceso limitado de Invitado especial pendiente. Para ese estado, las mutaciones de reserva y lista de espera se rechazan en el backend; las operaciones sensibles requieren permiso específico.
- Entradas de tRPC validadas con Zod; consultas SQL usan parámetros.
- Límite de body JSON de 64 KB, CORS al origen configurado, verificación de `Origin` en API tRPC y POST de autenticación, y headers de Helmet.
- No se inserta HTML proporcionado por usuarios.
- Los usuarios solo pueden leer/cancelar sus propias reservas y consultar sus propios tickets/notificaciones.
- La PWA solo guarda recursos estáticos y una página offline genérica. `/auth`, `/api` y `/trpc` nunca se cachean; ninguna mutación operativa está disponible offline.

## Reservas concurrentes e idempotencia

- Transacción InnoDB con lock del usuario y fila de cupo por fecha/servicio.
- El contador del cupo se modifica dentro de la transacción; el límite semanal de cinco se calcula en servidor, en zona `America/Argentina/Buenos_Aires`.
- Índice único por usuario/fecha/servicio protege las solicitudes repetidas.
- Ticket y reserva nacen en la misma transacción. Cancelación marca ambos estados y libera cupo en la misma operación.
- La lista de espera conserva orden por alta. Una oferta bloquea el cupo en la misma transacción para impedir dobles asignaciones; al confirmar se convierte en reserva sin contar el cupo dos veces.
- Las ofertas se notifican dentro de la aplicación y vencen a los 60 minutos o al llegar el límite de presentación, lo que ocurra primero. La expiración libera el cupo y promueve al siguiente usuario elegible; cancelaciones, rechazos y cambios de capacidad también intentan promover la cola.
- El alta, cancelación y confirmación de la lista de espera requieren sesión activa y permiso de reserva validado por el servidor. Los puestos propios se consultan por usuario; un tercero no puede confirmar ni cancelar una oferta ajena.
- La cancelación de una reserva propia está permitida hasta la hora de cierre de reservas configurada para el servicio en la fecha de la reserva; el límite también se aplica en servidor. Los no-show se registran sin sanciones automáticas mientras no exista una política institucional aprobada.
- La tabla `idempotency_keys` está preparada, pero no existe aún una API genérica que acepte claves idempotentes. La protección de reserva se apoya en transacción, bloqueo e índice único; no debe generalizarse esa garantía a pagos u otras operaciones futuras.

## QR y validación anti-replay

- El QR serializa identificador opaco de ticket y firma HMAC-SHA256; no incluye correo, nombre, CBU ni credenciales.
- `QR_SIGNING_SECRET` debe ser distinto de `SESSION_SECRET`.
- El ticket con número de turno se emite cuando la reserva está aprobada y el pago está resuelto. La acreditación aprobada de un pago grupal aprueba únicamente las reservas vinculadas a esa referencia, registra al responsable y emite un ticket independiente para cada fecha/servicio con su número ya asignado. El estudiante puede consultar/imprimir sus propios turnos; el QR solo se muestra si el ticket está emitido y disponible. La sección administrativa «Turnos» permite al Administrador Local y al Supervisor consultar los turnos confirmados en orden numérico; el Administrador Local imprime una planilla de cocina con turno, nombre y apellido, sin datos de pago o beca.
- El servidor verifica la firma en tiempo constante. La validación bloquea el ticket en la transacción, verifica estado y fecha local, marca ticket y reserva como usados y escribe auditoría.
- Una segunda validación falla porque el estado ya no es `DISPONIBLE`.
- Los QR se consumen para la fecha del servicio; no hay un campo separado de expiración configurable.

## Auditoría y privacidad

- Se registran creación, cancelación, aprobación y rechazo de reservas; ofertas, expiraciones y cancelaciones de lista de espera; asignación/cambio de beneficios; solicitudes/revisión de becas y pagos; cambios de tarifas/cupos/usuarios; guardado de menú; actualización de incidentes y consumo de tickets.
- La auditoría guarda actor, acción, recurso, resultado, metadata mínima y timestamp. No se registran IPs en los eventos de auditoría; la sesión activa guarda únicamente una subred parcial para mostrarla al propio usuario.
- No se almacenan PAN, CVV ni credenciales bancarias. BNA+ está definido únicamente como medio manual: se registra una referencia, el personal autorizado contrasta el pago en el canal institucional y lo revisa en el sistema. No hay API/webhook configurado; automatizar requiere convenio y documentación oficial para comercios.
- Los eventos financieros y las versiones presentadas de comprobantes se almacenan por separado; el acceso a cada imagen vuelve a comprobar titular/permiso en el servidor. Una imagen o revisión documental no confirma acreditación.
- Los pagos anteriores a los eventos financieros no se interpretan automáticamente como acreditados. La conciliación compara centavos enteros del total histórico, importe declarado y acreditación informada; una diferencia no se imputa.
- El efectivo queda ligado a operador, jornada y recibo correlativo único. Los cierres conservan teórico, conteo y diferencia; la anulación es compensatoria y deja motivo/auditoría.
- Logs de error no deben incorporar secretos. No activar logs de queries con parámetros sensibles en producción.

## ULTIX DEFENSA

- `/defensa` es una vista adicional del centro de seguridad existente; no agrega permisos ni endpoints de datos nuevos. La interfaz la muestra solo a `SUPERVISOR`, y los procedimientos que alimentan el panel conservan su verificación backend `audit:read`, exclusiva de ese rol. La verificación TOTP existente para cuentas privilegiadas sigue aplicándose.
- La bandera `ULTIX_DEFENSA` (activada por defecto, configurable en entorno) permite ocultar y bloquear esta ruta de interfaz sin desactivar las rutas `/seguridad` y `/auditoria` preexistentes.
- El panel reutiliza métricas, eventos e incidentes existentes. La puntuación es una heurística, no detección mediante IA ni respuesta automática. `REQUEST_REAUTH` queda registrada como solicitud y no fuerza la reautenticación de otra sesión.
- Los fallos del acceso local y de MFA se agregan a la auditoría sin registrar credenciales ni identificadores introducidos. El feed oculta el correo, rol, motivo y demás identidad en eventos fallidos. Los fallos gestionados externamente por Google no se incluyen en el contador local.
- No se modifican OAuth, las sesiones, los roles, las tablas, las migraciones ni los datos existentes. Desactivar la bandera oculta `/defensa`; las vistas y protecciones de seguridad anteriores permanecen disponibles.

## Puesta en producción pendiente

- Rotar y custodiar secretos mediante un secret manager; habilitar HTTPS y revisar cabeceras/proxy.
- Configurar una entrega segura de secretos también para desarrollo local; `.env.example` deja los secretos vacíos deliberadamente.
- Configurar monitoreo, alertas, retención de auditoría y backups cifrados con ejercicios de restauración.
- Definir restricciones de dominio institucional si la política UNCA lo exige; la dirección oficial permitida no está codificada porque no fue especificada.
- Definir el método oficial para verificar pertenencia/rol institucional. El registro actual no comprueba dominio de correo ni consulta un padrón institucional; no tratar el rol autodeclarado al registrarse como prueba de identidad.
- Integrar protección distribuida de fuerza bruta/rate limiting en múltiples instancias si se escala horizontalmente.
- Añadir pruebas de integración de concurrencia y de flujo OAuth contra MySQL dedicado antes de producción.
- Migraciones Drizzle aplicadas y 43 tablas verificadas en la MariaDB 10.4.32 de XAMPP de este entorno; se debe validar también la versión destino antes de desplegar.
- La asignación de beneficios se almacena y audita, pero no altera por sí sola la tarifa: el importe de una reserva se determina a partir de una beca aprobada y la tarifa vigente en `price_history`. BNA+ se mantiene en flujo manual; no hay pago automático. Correo y notificaciones push quedan aplazados. La aplicación no incluye carga de documentación personal ni sincronización OAuth con Google Calendar.
