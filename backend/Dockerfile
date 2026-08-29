FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Las migraciones corren con ts-node desde el arranque del compose, así que el
# runtime necesita el data-source compilado, no las fuentes.
COPY --from=build /app/dist/database ./dist/database
EXPOSE 4100
CMD ["node", "dist/main.js"]
