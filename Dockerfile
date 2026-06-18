FROM node:lts-alpine

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=80

EXPOSE 80

CMD ["node", "server.js"]
