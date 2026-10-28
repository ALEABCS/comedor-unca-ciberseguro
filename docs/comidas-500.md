# Catálogo de 500 comidas

## Instalación

Para integrar los datos con la aplicación, ejecutá las migraciones y el seed:

```powershell
npm run db:migrate
npm run db:seed
```

El seed es idempotente: conserva alimentos y menús existentes. La tabla especializada `comidas` recibe 500 filas con identificadores `001` a `500`; las mismas preparaciones quedan disponibles en el catálogo actual como `PREPARACION`. Para importar el catálogo en phpMyAdmin de forma independiente, ejecutá [database/comidas_500.sql](../database/comidas_500.sql). Ese archivo usa `CREATE TABLE IF NOT EXISTS` e `INSERT IGNORE`, no elimina ni reemplaza datos.

## Estructura

La tabla conserva todos los campos solicitados: identidad, categoría, servicio, descripción, ingredientes, preparación, porción, seis valores numéricos nutricionales, tiempo, dificultad, costo ARS, aptitud para comedor y observaciones. También agrega nombre normalizado único, fuente de proteína, método de cocción y booleanos para filtrar vegetarianos, carne, pescado y legumbres. Los índices cubren categoría, servicio, aptitud, calorías, proteínas, costo, tiempo, dificultad y filtros dietarios.

Los primeros 250 registros son `NUTRICIONAL`; los IDs `251` a `500` son `CHATARRA`. La comida de baja calidad está identificada como consumo ocasional. La categoría no equivale a una evaluación clínica. Calorías y macros mantienen la relación energética de 4 kcal/g para proteínas y carbohidratos y 9 kcal/g para grasas.

## Calidad y contexto

La validación automatizada exige exactamente 500 filas, conteos 250/250, IDs y nombres normalizados únicos, texto obligatorio y valores numéricos finitos. La base local quedó con 500 filas en `comidas`; se conservaron los 202 alimentos base anteriores y el catálogo de la app quedó en 702 filas, de las cuales 561 son preparaciones.

Los costos, nutrientes y tiempos son estimaciones por porción para presupuestar y probar filtros. No son cotizaciones ni análisis bromatológicos certificados; el comedor debe sustituirlos por recetas, gramajes, fichas de proveedor y precios vigentes. Los alérgenos y aptitudes sin TACC no se infieren a partir de los ingredientes.

## SQL incluido

El archivo SQL contiene, en este orden:

1. La definición de `comidas` con índices.
2. Los 250 platos nutricionales, IDs `001` a `250`.
3. Los 250 platos de baja calidad nutricional, IDs `251` a `500`.
4. Los `INSERT IGNORE` completos para las 500 filas.
5. Consultas para conteos, almuerzos/cenas, costo, proteína y calorías.
6. Una vista previa semanal con 7 días, almuerzo y cena, usando un 80% nutricional parametrizable.

El SQL fue ejecutado completo en MariaDB local y puede volverse a importar sin duplicar las filas. No contiene `DROP DATABASE` ni `DROP TABLE`.

## Menús automáticos

En el Constructor de menú, el Administrador local puede generar borradores diarios, semanales o de 30 días y guardar un porcentaje nutricional entre 0 y 100. El valor inicial es 80%. La aplicación:

- genera almuerzo y cena;
- distribuye el porcentaje según los turnos disponibles (por ejemplo, 11 de 14 para una semana al 80%);
- alterna fuentes de proteína y métodos de cocción, penaliza similitud entre almuerzo y cena y no repite platos del mismo lote;
- omite los servicios que ya tienen un menú y excluye los platos identificados en menús del período y días vecinos;
- crea borradores, registra auditoría y deja la publicación a revisión explícita.

La consulta semanal del SQL es una vista previa de selección. Para guardar menús desde MySQL con las protecciones de concurrencia, auditoría y preservación de datos, usá el generador de la aplicación.
