# Build from repository root: docker build -f web-server/Dockerfile -t admin-panel-web .
FROM node:24-bookworm-slim AS build
WORKDIR /app/web-server
COPY web-server/package.json web-server/package-lock.json ./
RUN npm ci
COPY web-server/ ./
COPY src/main/resources/icons/ /app/src/main/resources/icons/
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY web-server/package.json web-server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/web-server/dist/ ./dist/
COPY --from=build /app/web-server/public/ ./public/
COPY web-server/admin-panel.example.properties ./
COPY web-server/scripts/setup.mjs ./scripts/setup.mjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/server/main.js"]
