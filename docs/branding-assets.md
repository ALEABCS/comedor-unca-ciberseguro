# Inventario de identidad visual

Los archivos de `public/branding/originals/` son copias sin modificar de los ocho recursos inspeccionados visualmente en `IMAGENES PARA USAR DEL COMEDOR.zip`. Las versiones web optimizadas están junto a esa carpeta; no reemplazan los originales.

| Archivo proporcionado | Dimensiones y formato | Identificación visual | Uso en la aplicación |
|---|---:|---|---|
| `LOGO E ICONO DEL COMEDOR UNIVERSITARIO.png` | 1451 × 1084, PNG RGBA | Emblema del Comedor con el nombre UNCA; el mismo PNG ya existía en el proyecto y sus copias tenían SHA-256 idéntico. | Logo optimizado `comedor-logo.webp` en acceso, navegación, tickets y panel operativo. Iconos PNG derivados, ajustados proporcionalmente y sin recorte para favicon, Apple Touch Icon y PWA. |
| `logo-vector-universidad-nacional-de-catamarca.webp` | 630 × 320, WebP | Marca horizontal de Universidad Nacional de Catamarca — UNCA. | `unca-wordmark.webp` en acceso, pie de aplicación y pantalla sin conexión. |
| `COMEDOR UNIVERSITARIO FONDO INSTITUCIONAL.jpg` | 739 × 415, JPEG | Exterior del edificio, con la identificación UNCA y Comedor Universitario visible en la fachada. | `exterior-hero.webp` como fondo del acceso, con overlay oscuro para contraste. |
| `COMEDOR UNIVERSITARIO FOTO 1.jpg` | 596 × 335, JPEG | Comedor en actividad, con personas almorzando. | `dining-service.webp`, primera imagen del carrusel del panel de inicio. |
| `COMEDOR UNIVERSITARIO FOTO 2.jpg` | 516 × 387, JPEG | Salón interior amplio, mesas y sillas. | `dining-room.webp`, segunda imagen del carrusel del panel de inicio. |
| `COMEDOR UNIVERSITARIO FOTO 3.jpg` | 1024 × 768, JPEG | Grupo identificable junto al edificio y un cartel de una actividad específica. | `community-visit.webp`, tercera imagen del carrusel; se identifica de forma descriptiva, sin añadir nombres de las personas. |
| `COMEDOR UNIVERSITARIO  FOTO 4.jpg` | 548 × 364, JPEG | Segunda vista exterior del edificio. | `exterior-secondary.webp`, cuarta imagen del carrusel del panel de inicio. |
| `COMEDOR UNIVERSITARIO FOTO 5.jpg` | 1280 × 675, JPEG | Fila de atención en el interior del comedor, con personas visibles. | `service-queue.webp`, quinta imagen del carrusel; se identifica de forma descriptiva, sin añadir nombres de las personas. |

## Derivados y política de conservación

- Las seis fotografías se convirtieron a WebP manteniendo sus dimensiones originales, con calidad 82; los JPEG originales siguen disponibles.
- El emblema se redujo proporcionalmente y se codificó como WebP con transparencia. La imagen suministrada no se recoloreó ni deformó.
- Los iconos `comedor-icon-192.png`, `comedor-icon-512.png`, `apple-touch-icon.png` y `favicon-32.png` se generaron desde el emblema; el manifiesto usa PNG cuadrados de 192 y 512 px.
- El wordmark UNCA se distribuye sin recompresión adicional.
- `client/src/branding.ts` centraliza las rutas de marca consumidas por React. Las referencias CSS necesarias para los fondos y las rutas declarativas de favicon/PWA usan los mismos archivos.
- El panel de inicio presenta las cinco fotografías en un carrusel manual con controles anterior/siguiente e indicadores accesibles. No avanza automáticamente, para evitar movimiento inesperado y mantener el control del usuario.
