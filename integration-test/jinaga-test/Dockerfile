FROM node:alpine3.12

COPY package.json .
COPY package-lock.json .
COPY jinaga.js .
COPY jinaga.js.map .
COPY jinaga.test.js .
RUN npm install

ENTRYPOINT [ "npm", "test" ]