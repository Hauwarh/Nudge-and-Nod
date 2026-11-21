# Ubuntu/Debian bookworm has glibc 2.36, above the SmartSpectra floor of 2.35.
# Render's free web service can build this image. The SDK npm package depends on
# every platform runtime (about 100MB each). The install step deletes the ones
# this image will never load, in the same layer, so they are not stored.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci \
  && rm -rf \
    node_modules/@smartspectra/node-sdk-darwin-arm64 \
    node_modules/@smartspectra/node-sdk-win32-x64 \
    node_modules/@smartspectra/node-sdk-linux-arm64
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 10000
CMD ["node", "server/dist/index.js"]
