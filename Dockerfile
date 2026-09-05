FROM node:lts-alpine

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=80

EXPOSE 80

# server.js watches its own source files (see its restartOnChange()) and exits(0) to request a
# restart on change — nodemon used to be the thing that noticed that exit and relaunched it, but
# that required nodemon's own --watch list to independently track every file server.js already
# watches itself. Those two lists drifted out of sync (nodemon's baked into an old image only
# watched server.js, not the server/ dir) and left the app down with nodemon sitting idle in
# "waiting for changes" — a clean exit that never has to be looked for. This loop just relaunches
# node unconditionally on any exit, clean or crashed, so there is nothing left to keep in sync.
CMD ["sh", "-c", "while true; do node server.js; echo 'server exited, restarting...'; sleep 1; done"]
