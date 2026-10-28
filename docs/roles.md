# Roles y permisos

La aplicación aplica la misma matriz en los procedures del servidor (`shared/domain.ts`) y en la navegación visible. Ocultar un enlace no constituye autorización: el backend compara el rol de sesión en cada procedure.

| Módulo / acción | Alumno | Docente | No docente | Invitado especial | Administrador local | Supervisor |
|---|---:|---:|---:|---:|---:|---:|
| Consultar menús publicados | Sí | Sí | Sí | Sí | Sí | Sí |
| Crear reservas propias | Sí | Sí | Sí | Sí | — | — |
| Consultar/cancelar reservas propias | Sí | Sí | Sí | Sí | — | — |
| Consultar listado operativo de reservas | — | — | — | — | Sí | Sí |
| Consultar turnos confirmados | — | — | — | — | Sí | Sí |
| Administrar reservas | — | — | — | — | Sí | Sí |
| Aprobar o rechazar reservas sin pago pendiente | — | — | — | — | Sí | Sí |
| Administrar/publicar menú | — | — | — | — | Sí | — |
| Consultar/registrar producción de cocina | — | — | — | — | Sí | Sí |
| Validar ticket y registrar consumo | — | — | — | — | Sí | Sí |
| Consultar e imprimir ticket propio habilitado | Sí | Sí | Sí | Sí | — | — |
| Imprimir planilla de cocina (turno, nombre, apellido) | — | — | — | — | Sí | — |
| Crear reporte de incidente | Sí | Sí | Sí | Sí | Sí | — |
| Consultar incidentes | — | — | — | — | Sí | Sí |
| Gestionar estado de incidentes | — | — | — | — | Sí | — |
| Consultar métricas operativas | — | — | — | — | Sí | Sí |
| Consultar auditoría | — | — | — | — | — | Sí |
| Consultar y crear usuarios, aprobar y asignar roles ordinarios | — | — | — | — | Sí | Sí |
| Asignar roles de Administrador Local/Supervisor | — | — | — | — | — | Sí |
| Administrar becas, tarifas y configuración | — | — | — | — | — | Sí |
| Asignar y administrar beneficios | — | — | — | — | — | Sí |
| Solicitar/consultar créditos de comida | Sí, según beca | — | — | — | — | Revisar solicitudes |
| Consultar y revisar referencias de pago | — | — | — | — | Sí | Sí |
| Presentar referencia de pago | Sí | Sí | Sí | Sí | — | — |
| Abrir/cerrar caja propia y registrar efectivo | — | — | — | — | Sí | Sí |
| Verificar documentación y registrar acreditación | — | — | — | — | Sí | Sí |
| Revisar diferencias de caja | — | — | — | — | Sí | Sí |
| Solicitar ajuste o devolución | — | — | — | — | Sí | Sí |
| Autorizar ajustes y registrar su ejecución | — | — | — | — | — | Sí |
| Exportar informe financiero | — | — | — | — | — | Sí |

El Administrador local gestiona la operación diaria (reservas, aprobaciones, menú, tickets, pagos e incidentes) y puede aprobar cuentas y asignar roles de Alumno, Docente, No docente o Invitado especial. No puede asignar ni modificar cuentas de Administrador Local o Supervisor. El Supervisor puede asignar cualquiera de los roles; la gestión de becas y tarifas queda exclusivamente a su cargo. El Supervisor no administra el menú. La aprobación acreditada de un pago grupal aprueba cada reserva asociada y emite un ticket independiente con el turno correspondiente a su fecha y servicio. La pantalla «Turnos» permite consultar las reservas confirmadas en orden numérico; solo el Administrador Local imprime la planilla para cocina, que contiene turno, nombre y apellido. La API verifica cada acción en el servidor.

Los permisos financieros nuevos son granulares y aditivos (`payments:cash:manage`, `payments:reconcile`, `payments:adjustments:manage`, `payments:export`). Para el detalle del alcance y separación de etapas, consultar [`finance.md`](./finance.md).

## Asignación de roles

- Google verifica el control del correo, no la pertenencia institucional; una identidad nueva recibe el rol `INVITADO_ESPECIAL` y queda `PENDING`.
- Como excepción aprobada, el inicio con un correo Google verificado asigna `jolas@unca.edu.ar` a `SUPERVISOR` y `pmolina@unca.edu.ar` a `ADMINISTRADOR_LOCAL`. Las cuentas existentes no suspendidas se activan y el cambio queda auditado; las suspendidas permanecen suspendidas. Si no existían, se crean activas con el rol indicado. En ambos casos se exige configurar/verificar TOTP antes de operar.
- Las identidades Google heredadas que sigan `ALUMNO`/`PENDING` con el mismo Google Subject se convierten a Invitado al volver a autenticarse; el cambio queda auditado y no afecta cuentas activas, roles ya revisados ni altas locales.
- El registro local permite únicamente roles de usuario final. No hay endpoint de autoservicio para elevar rol.
- Las cuentas nuevas por registro local o creación administrativa quedan `PENDING` y no pueden iniciar sesión hasta su aprobación. Una identidad nueva de Google entra como invitado pendiente y puede usar las funciones disponibles para Invitado especial; crear/cancelar reservas y operar la lista de espera queda bloqueado hasta la aprobación.
- El Administrador Local puede aprobar cuentas y asignar roles ordinarios. El Supervisor puede aprobar y asignar todos los roles, incluidos Administrador Local y Supervisor. La decisión se audita y genera una notificación en la aplicación. `SUSPENDED` se mantiene sin acceso.
- Las cuentas `ACTIVE` preexistentes se conservan sin cambios para no interrumpir sesiones; la nueva revisión aplica a cuentas nuevas. Su revisión retroactiva debe decidirse y ejecutarse explícitamente.
- El modo de demostración utiliza seis cuentas de acceso rápido por rol y dos cuentas locales con contraseña (`comedor` / `comedor123` para Administrador local; `supervisor` / `supervisor123` para Supervisor), solo cuando `DEMO_MODE=true` y fuera de producción. Las contraseñas se almacenan con hash y el seed no sobrescribe usuarios existentes.

## Fuente de verdad

La matriz de ejecución está centralizada en `shared/domain.ts` para no duplicar reglas del backend. `database/comedor_unca.sql` incluye tablas normalizadas de roles, permisos y asignaciones como referencia operativa; la autorización se calcula a partir de la matriz de TypeScript y no consulta tablas `role_permissions` en cada request.
