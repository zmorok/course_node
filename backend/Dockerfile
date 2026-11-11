FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.js ./
RUN npm ci --no-audit --no-fund --include=dev \
    && npm run prisma:generate \
    && npm prune --omit=dev --no-audit --no-fund
COPY --chown=node:node src ./src
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
