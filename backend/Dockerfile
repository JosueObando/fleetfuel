FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Etapa de desarrollo: hereda de `build`, así que conserva las devDependencies
# (ts-node, @nestjs/cli, jest) y el árbol `src/`. Es lo que hace que funcionen
# tal cual los comandos que documenta el README y que el compose invoca al
# arrancar: `npm run migration:run` y `npm run seed` son scripts de ts-node
# sobre `src/`, no sobre `dist/`.
FROM build AS development
ENV NODE_ENV=development
EXPOSE 4100
CMD ["npm", "run", "start:dev"]

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Aquí no hay `src/` ni ts-node: `npm ci --omit=dev` los deja fuera. Por eso el
# arranque de esta etapa usa los scripts `:dist`, que operan sobre el código
# compilado con el CLI de typeorm — que sí sobrevive, porque `typeorm` es una
# dependencia de producción y no de desarrollo.
#
#   npm run migration:run:dist   en vez de   npm run migration:run
#   npm run seed:dist            en vez de   npm run seed
EXPOSE 4100
CMD ["node", "dist/main.js"]
