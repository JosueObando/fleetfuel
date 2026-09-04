# Imagen de producción del frontend.
#
# Tres etapas para que la final NO contenga el código fuente, ni las
# dependencias de desarrollo, ni la caché de compilación: lo único que viaja a
# producción es el servidor autónomo que Next genera.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# La URL de la API se hornea en el bundle del navegador: NEXT_PUBLIC_* se
# resuelve al compilar, no al arrancar. Por eso es un argumento de
# construcción y no una variable de entorno del contenedor —ponerla en
# `environment` no tendría ningún efecto.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Usuario sin privilegios: si alguien consigue ejecutar algo dentro del
# contenedor, que no sea root. La imagen de node ya trae el usuario `node`.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
