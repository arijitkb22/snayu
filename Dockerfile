FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY mcp.json ./

RUN mkdir -p data

EXPOSE 3456

ENV PORT=3456
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
