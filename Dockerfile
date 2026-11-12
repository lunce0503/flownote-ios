FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder

ARG EXPO_PUBLIC_WAS_URL
ENV EXPO_PUBLIC_WAS_URL=${EXPO_PUBLIC_WAS_URL}
ENV EXPO_NO_TELEMETRY=1

COPY . .
RUN test -n "$EXPO_PUBLIC_WAS_URL" && npm run build:web

FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/dist ./dist
COPY scripts/serve-static.mjs ./scripts/serve-static.mjs

EXPOSE 8080

CMD ["node", "scripts/serve-static.mjs"]
