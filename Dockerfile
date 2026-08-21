FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: the server imports only node: builtins (node:sqlite, native TS stripping), so no node_modules.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY sync ./sync
COPY seed ./seed
COPY --from=build /app/dist ./dist
# `codex` (tips job) is mounted from the host at /opt/codex — see docker-compose.yml
RUN ln -s /opt/codex/bin/codex.js /usr/local/bin/codex
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
