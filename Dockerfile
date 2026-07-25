# Stage 1: Install production deps
FROM node:18-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Build
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: Production
FROM node:18-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=dependencies --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --chown=nestjs:nodejs package.json ./

# The migration CLI (`npm run migration:run`) executes TypeORM's DataSource
# config via ts-node rather than the compiled dist output, so the runtime
# image needs the migration sources plus a minimal ts-node toolchain.
COPY --chown=nestjs:nodejs tsconfig.json ./
COPY --chown=nestjs:nodejs src/config/typeorm.config.ts ./src/config/typeorm.config.ts
COPY --chown=nestjs:nodejs src/database/migrations ./src/database/migrations
RUN npm install --no-save ts-node@^10.9.2 typescript@^5.3.3 tsconfig-paths@^4.2.0

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode) })"

CMD ["sh", "-c", "npm run migration:run && node dist/main.js"]
