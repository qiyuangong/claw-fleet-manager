FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN npm ci

FROM deps AS build
WORKDIR /app

COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN npm ci --omit=dev

COPY --from=build /app/packages/server/dist /app/packages/server/dist
COPY --from=build /app/packages/web/dist /app/packages/web/dist
COPY --from=build /app/packages/server/server.config.example.json /app/packages/server/server.config.example.json

EXPOSE 3001

WORKDIR /app/packages/server
CMD ["node", "dist/index.js"]
