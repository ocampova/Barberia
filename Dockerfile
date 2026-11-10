FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=8080 DB_FILE=/data/barberia.db
# La base de datos vive en /data: monta ahí un disco persistente
# (Railway: Volume en /data; Docker: -v barberia-data:/data).
RUN mkdir -p /data && chown node:node /data
EXPOSE 8080
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
