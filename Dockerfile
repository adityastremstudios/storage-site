# ---- build admin panel ----
FROM node:20-alpine AS client
WORKDIR /build/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client .
RUN npm run build

# ---- server ----
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --no-audit --no-fund
COPY server .
RUN npx prisma generate
COPY --from=client /build/client/dist ./public/admin
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "./docker-entrypoint.sh"]
