# Multi-stage build: compile TypeScript, then ship only the runtime output.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY api ./api
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public

EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/src/devServer.js"]
