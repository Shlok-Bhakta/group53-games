FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
COPY games ./games
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server.mjs"]
