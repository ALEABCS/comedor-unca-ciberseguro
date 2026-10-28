# Operación financiera

Este módulo agrega conciliación manual, registro de efectivo, recibos y cierres diarios sin reemplazar la pantalla ni los flujos existentes de pagos. No consulta bancos ni billeteras y no acredita automáticamente una referencia o una imagen.

## Estados y flujo electrónico

1. El usuario selecciona sus reservas pendientes e informa medio, referencia de operación, importe declarado y comprobante por el flujo actual.
2. El servidor valida que las reservas pertenezcan al usuario, estén pendientes, compartan moneda y no tengan otro pago activo. La referencia no puede repetirse dentro del mismo medio de pago; referencias iguales de medios distintos no se consideran la misma operación. Cada archivo queda como evidencia inmutable adicional; reenviar una captura no borra la anterior.
3. Administrador Local o Supervisor puede verificar/rechazar la documentación. Verificarla solo agrega un evento; no cambia la reserva a pagada.
4. Administrador Local o Supervisor contrasta el movimiento en el canal institucional y registra el importe acreditado, referencia institucional y observación. La operación solo se concilia si coinciden exactamente el total histórico de las reservas, el importe declarado y el importe acreditado.
5. Una diferencia se conserva como observación: el pago sigue pendiente, no se crean imputaciones y no se confirma ninguna reserva.
6. Al coincidir los importes, una transacción crea una imputación explícita por cada reserva vinculada, registra la acreditación/auditoría y marca cada reserva como pagada, aprobada y confirmada; se emite un ticket con el número ya asignado a cada fecha y servicio. La acreditación grupal solo incluye las reservas asociadas a esa referencia y no altera otros días o servicios del usuario. Las tarifas históricas no se recalculan.

Los pagos aprobados antes de esta ampliación no se reinterpretan como acreditados. Se cuentan en “Histórico por revisar” hasta que personal autorizado valide la evidencia institucional. Las referencias de texto sin comprobante siguen disponibles y se guardan como eventos de presentación.

## Efectivo y recibos

1. Personal con permiso de caja abre una jornada e informa el efectivo inicial contado. Cada operador puede tener una sola caja abierta.
2. Selecciona una persona y una o más reservas pendientes elegibles. El servidor vuelve a validar titular, estado, moneda e importe histórico; actualmente el cobro agrupado debe ser exacto y no se admiten pagos parciales.
3. Solo después de confirmar que recibió físicamente el dinero, el operador registra el cobro. Se generan un pago `EFECTIVO`, una imputación por reserva, un recibo correlativo no reutilizable y eventos auditados en una transacción; cada reserva incluida queda aprobada y confirmada y recibe su ticket con el turno asignado a su fecha/servicio.
4. Al cierre, el sistema calcula `saldo inicial + recibos confirmados`. El usuario informa el conteo físico; la diferencia se conserva sin posibilidad de editar el importe teórico. Un Supervisor puede revisar y dejar constancia, pero no borrar la diferencia.
5. Un recibo erróneo puede anularse con motivo por Supervisor. El registro original se conserva, se crea un evento compensatorio y la reserva vuelve a pendiente solo si aún no se consumió el servicio. Los cierres ya realizados no se alteran.

No se habilitaron otros ingresos/egresos de caja ni pagos parciales. Transferencias y billeteras no participan del efectivo teórico.

## Ajustes y devoluciones

Las solicitudes de devolución, ajuste o anulación se hacen sobre un pago acreditado y no pueden superar el saldo acreditado libre, contando solicitudes pendientes para bloquear sobredevoluciones concurrentes. Un Supervisor distinto del solicitante debe autorizar o rechazar. La solicitud y autorización no significan que el dinero se haya devuelto. Solo “Registrar ejecución verificada” con referencia institucional cambia el estado a ejecutado. No se realizan transferencias ni se simulan integraciones externas.

## Permisos

| Permiso | Roles | Alcance |
|---|---|---|
| `payments:read` | Administrador Local, Supervisor | Consultas y detalle según los permisos de pagos existentes |
| `payments:manage` | Administrador Local, Supervisor | Revisión documental y solicitudes de ajuste |
| `payments:cash:manage` | Administrador Local, Supervisor | Abrir/cerrar caja propia y registrar efectivo |
| `payments:reconcile` | Administrador Local, Supervisor | Confirmar acreditación, anular recibos y revisar diferencias |
| `payments:adjustments:manage` | Supervisor | Autorizar/rechazar ajustes y registrar ejecución |
| `payments:export` | Supervisor | Exportar hasta 5.000 pagos filtrados; cada exportación se audita |

Los permisos previos no se quitaron ni ampliaron; los nuevos se agregan de forma granular. Los procedimientos del backend requieren sesión activa y, para roles privilegiados, TOTP verificado. Los comprobantes usan rutas privadas con control de propietario/permiso y `Cache-Control: no-store`.

## Datos, migración y recuperación

La migración `0022_lowly_ultimatum.sql` crea seis tablas nuevas: `cash_receipts`, `cash_shifts`, `finance_adjustments`, `payment_allocations`, `payment_evidence` y `payment_finance_events`. Las tablas existentes de reservas y pagos no se alteran. Los eventos y comprobantes son append-only desde los flujos normales; la anulación agrega estado/motivo en el recibo original y un evento compensatorio.

La migración `0023_light_nick_fury.sql` cambia `payment_finance_events.created_at` a precisión de microsegundos. Esto conserva el orden de eventos concurrentes del mismo pago en MariaDB, donde la precisión predeterminada de `TIMESTAMP` es de un segundo. La migración `0026_tiny_lady_bullseye.sql` limita la unicidad de la referencia al medio de pago además del proveedor, para no bloquear identificadores iguales emitidos independientemente por medios diferentes.

En este equipo la base es MariaDB 10.4.32. Los campos opcionales de cierre/anulación usan `DATETIME`, por compatibilidad con `explicit_defaults_for_timestamp=0`. La primera aplicación falló antes de completar el journal por restricciones de MariaDB (primero timestamps, luego un nombre de FK); no llegó a modificar pagos o reservas. El reparador `npm run db:repair-finance` verifica un dump por tamaño/hash, exige que el journal siga en `0021`, conserva tablas parciales vacías, agrega solo constraints/índices faltantes y registra el hash Drizzle al final. No elimina tablas. `npm run db:migrate` posterior comprobó las 43 tablas.

Respaldo previo local verificado:

- Archivo: `%LOCALAPPDATA%\ComedorUNCA\database-backups\basecomedorunca2026-2026-10-16T23-34-02-726Z.sql`
- Tamaño: 811.293 bytes
- SHA-256: `4253f89bbafcb319a8ed246fbc5ed04ff3b109dcb66f285bb8d62c17f0154db1`

El dump contiene esquema y datos; no se incluye en el ZIP. Para recuperar, detén la aplicación, conserva una copia del estado actual, valida el hash del dump y restaura el `.sql` en una base de recuperación o en una ventana de mantenimiento mediante el cliente `mysql`/phpMyAdmin autorizado. El dump usa `--databases`, por lo que contiene `CREATE DATABASE`/`USE`; confirma el destino antes de restaurar. No importes sobre producción sin respaldo verificado y aprobación del responsable.

## Operación y pendientes

- `/pagos` conserva la experiencia existente.
- `/finanzas` añade filtros por fecha/persona/pago/reserva/medio/estado/responsable/caja/importe, paginación, detalle de eventos, caja y reportes.
- `npm run db:migrate` aplica las migraciones; `npm run db:seed` agrega los permisos nuevos de manera idempotente.
- No hay API bancaria. La referencia institucional acredita únicamente lo que un responsable verifica manualmente.
- La exportación implementada es CSV UTF-8 con protección de fórmulas. No hay exportación Excel binaria.
- Las instalaciones con pagos históricos aprobados requieren revisión humana; el sistema no los migra a acreditados.
- La operación se valida contra MariaDB local y pruebas automatizadas del proyecto; no se ejecutó una conciliación real, una devolución real ni una restauración de respaldo en esta entrega.