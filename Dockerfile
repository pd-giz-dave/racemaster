FROM node:lts-alpine

RUN npm install -g nodemon

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=80

EXPOSE 80

CMD ["nodemon", "--legacy-watch", "--watch", "server.js", "--watch", "server", "--signal", "SIGTERM", "server.js"]
