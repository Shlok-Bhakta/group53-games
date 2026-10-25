FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server.mjs"]
