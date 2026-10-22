FROM node:22.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build' DIRECT_URL='postgresql://build:build@127.0.0.1:5432/build' npm run build

# Release-only target: retains Prisma CLI and TSX for controlled migrations/seeding.
FROM build AS migration
ENV NODE_ENV=production
CMD ["npm", "run", "migrate:deploy"]

# Runtime image contains only production dependencies and compiled application code.
FROM build AS runtime
RUN npm prune --omit=dev && npm cache clean --force
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 RFID_BRIDGE_ENABLED=false
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
