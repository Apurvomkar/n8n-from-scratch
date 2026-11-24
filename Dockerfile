# Multi-stage build: compile the TypeScript API, build the React UI, then run
# the compiled server with production dependencies only.

FROM node:24-alpine AS api-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:24-alpine AS ui-builder
WORKDIR /app
COPY ui/package.json ui/package-lock.json ./ui/
RUN cd ui && npm ci
COPY ui ./ui
RUN cd ui && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/workflows.db
ENV KEY_PATH=/app/data/.encryption-key
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=api-builder /app/dist ./dist
COPY --from=ui-builder /app/ui/dist ./ui/dist
COPY workflows ./workflows
EXPOSE 3000
CMD ["node", "dist/src/server/index.js"]
