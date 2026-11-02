# Comedor UNCA: Express sirve la API y el cliente compilado desde un mismo proceso.

# Compila el cliente; necesita devDependencies (TypeScript y Vite).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Instala solo dependencias de producción. tsx es una de ellas: el servidor,
# las migraciones y el seed se ejecutan desde TypeScript sin compilar.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 4000
# node:22-slim no trae curl; /ready también comprueba la conexión con la base.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Se usa node directamente, no npm start, para que SIGTERM llegue al servidor.
CMD ["node", "--import", "tsx", "server/index.ts"]
