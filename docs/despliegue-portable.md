# Paquete portable y despliegue

`2027UNCAC.zip` contiene el código fuente, lockfile de npm, recursos, SQL, documentación y el build del cliente en `dist/`. No contiene secretos, `node_modules` ni configuraciones de una máquina específica. Los respaldos históricos se conservan como copias portable depuradas bajo `Backup/portable/`.

Para regenerar este paquete en Windows desde la raíz del proyecto, ejecutar en PowerShell:

```powershell
Invoke-Expression (Get-Content -LiteralPath 'scripts/prepare-portable-package.ps1' -Raw)
```

El script comprueba y depura los ZIP históricos, construye `2027UNCAC.zip` y lo valida antes de finalizar.

## Requisitos del servidor

- Node.js 20.19 o posterior, o Node.js 22.12 o posterior, con npm.
- MySQL 8 o compatible con MariaDB 10.4 o posterior y una base dedicada.
- HTTPS y un dominio configurado para Google OAuth si se habilita ese acceso.

## Puesta en marcha

1. Extraer `2027UNCAC.zip` en el servidor.
2. Crear una base de datos y un usuario MySQL limitado a esa base. No reutilizar la contraseña del equipo de desarrollo.
3. Configurar las variables desde el panel de secretos del proveedor. Para una instalación manual, copiar `.env.example` a `.env` fuera del ZIP y completar los valores:

```dotenv
NODE_ENV=production
PORT=4000
APP_URL=https://comedor.example.edu.ar
DATABASE_URL=mysql://usuario:clave@host:3306/basecomedorunca2026
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://comedor.example.edu.ar/auth/google/callback
SESSION_SECRET=
QR_SIGNING_SECRET=
TOTP_ENCRYPTION_SECRET=
DEMO_MODE=false
```

Usar secretos aleatorios, distintos entre sí y de al menos 32 caracteres. Generar cada valor en el servidor o en el administrador seguro de secretos; no subir `.env` a repositorios ni incluirlo en ZIP compartidos. `TOTP_ENCRYPTION_SECRET` debe respaldarse de forma privada: perderlo impide descifrar los factores TOTP.

4. En Google Cloud, registrar exactamente el callback HTTPS configurado arriba.
5. Instalar desde el lockfile y preparar la base:

```powershell
npm ci
npm run db:migrate
npm run db:seed
npm run build
npm start
```

`tsx` es una dependencia de producción, por lo que `npm start` funciona también cuando npm omite `devDependencies`. El seed es repetible y no crea cuentas de demostración si `DEMO_MODE=false`.

6. Configurar el proxy HTTPS para enviar tráfico al puerto Node y establecer `X-Forwarded-Proto`. Express sirve el cliente compilado de `dist/` y las rutas API desde el mismo proceso.
7. Verificar `https://comedor.example.edu.ar/ready`; debe responder `200` con `ready: true` y `database: connected`.

## Datos de comidas

Para instalar la aplicación completa, ejecutar `db:migrate` y `db:seed`; eso agrega el catálogo de 500 comidas a la tabla especializada y al constructor de menús sin borrar los alimentos actuales. `database/comidas_500.sql` es una opción independiente para phpMyAdmin, no reemplaza las migraciones del resto de la aplicación.

Los valores de costo y nutrición incluidos son orientativos y deben validarse institucionalmente antes de usarse para decisiones alimentarias o presupuestos.
