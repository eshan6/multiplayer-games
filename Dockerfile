# Single deployable image: builds the client, compiles the server, serves both
# from one Node process on one port. Works unchanged on Fly, Render and Railway.
FROM node:22-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts ./
COPY src ./src
COPY config ./config
COPY data ./data
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The bank and the rules are read at boot from disk, so they ship with the image.
COPY config ./config
COPY data ./data

# Repeat-avoidance history lives here. Mount a volume at /data to keep it
# across restarts; without one the pair's history resets on redeploy.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
