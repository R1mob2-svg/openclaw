FROM node:22-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD [ "node", "src/server.js" ]
