FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY server/ ./server/
COPY public/ ./public/

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
