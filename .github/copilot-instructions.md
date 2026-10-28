# Instrucciones para GitHub Copilot

## Contexto del proyecto

Antes de cambiar código, consulta [docs/copilot-context.md](../docs/copilot-context.md) y, para las reglas operativas, la documentación específica en `docs/`. No dupliques ni contradigas las políticas de seguridad, permisos, pagos o reservas documentadas allí.

## Conservación y privacidad

- No abras, muestres, edites ni incluyas en respuestas el contenido de `.env`, credenciales, tokens, claves, datos personales o información real de usuarios. Usa `.env.example` para entender los nombres de configuración.
- No ejecutes migraciones, seeds, reparaciones ni copias de bases de datos para una tarea de código sin autorización explícita y un entorno de prueba confirmado.
- Conserva los archivos existentes, los respaldos y los activos de `public/`. `npm run build` escribe en `dist/`; comprueba su estado antes de ejecutarlo.
- No añadas dependencias ni envíes código, configuración o datos privados a servicios externos sin necesidad y autorización.
- No afirmes que una herramienta está instalada, conectada o probada sin evidencia funcional.

## Cambios y validación

- Mantén TypeScript estricto y sigue las convenciones del código existente. Valida entradas con Zod y aplica autenticación/autorización en el servidor; ocultar una opción en la interfaz no sustituye la autorización.
- Haz cambios acotados, sin reemplazar flujos o políticas institucionales existentes.
- Para cambios de lógica, ejecuta `npm test` y `npm run typecheck`. Ejecuta otras verificaciones solo si son pertinentes y seguras para los archivos existentes.
- Si no puedes comprobar el control de versiones, no supongas que el árbol de trabajo está limpio; preserva los archivos y cambios preexistentes.
