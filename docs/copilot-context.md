# Contexto estable para Copilot

Este documento conserva decisiones y convenciones verificadas del proyecto. La documentación funcional y de seguridad enlazada sigue siendo la fuente de verdad; actualiza este resumen solo cuando cambie la arquitectura o una convención estable.

## Arquitectura

- Aplicación institucional del Comedor Universitario UNCA.
- Cliente React y TypeScript servido por Vite en `client/`.
- API Express con tRPC en `server/`; reglas compartidas y tipos de dominio en `shared/`.
- Persistencia MySQL/MariaDB con Drizzle en `server/db/` y scripts SQL en `database/`.
- Autenticación OAuth/local, sesiones, autorización por rol y controles de seguridad implementados en el servidor.
- TypeScript está configurado en modo estricto. Las entradas de API se validan con Zod.

## Invariantes de dominio y seguridad

- La autorización del backend es obligatoria para toda operación protegida. La matriz y su explicación están en [roles](./roles.md).
- No se debe cambiar el flujo de reservas, pagos, sesiones, QR, auditoría o privacidad sin revisar [seguridad](./security.md) y, para pagos, [finanzas](./finance.md).
- Los pagos se revisan manualmente; no se debe inferir una acreditación a partir de un comprobante.
- No se deben añadir secretos, credenciales, datos personales ni información real de usuarios a código, pruebas, documentación o prompts.
- Las migraciones, semillas, reparaciones y copias de datos pueden modificar estado persistente: no son comandos de validación de rutina.

## Verificación local

- `npm test`: ejecuta Vitest (`vitest run`); las pruebas están distribuidas entre `client/`, `server/`, `shared/` y `tests/`.
- `npm run typecheck`: ejecuta `tsc --noEmit`.
- `npm run build`: comprueba tipos y genera archivos en `dist/`; puede reemplazar artefactos existentes, por lo que se debe revisar el destino antes de ejecutarlo.
- Las pruebas unitarias no verifican por sí solas la persistencia MySQL, Google OAuth ni el comportamiento extremo a extremo; para ello se requiere un entorno de prueba autorizado y configurado.

## Documentación de referencia

- [README](../README.md): instalación, comandos, estructura y operación.
- [Seguridad](./security.md): límites de seguridad y privacidad.
- [Roles](./roles.md): permisos y responsabilidades.
- [Finanzas](./finance.md): conciliación y operaciones financieras.
- [Despliegue portable](./despliegue-portable.md): preparación de una instalación.
