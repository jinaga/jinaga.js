FROM node:alpine3.12

COPY package.json .
COPY package-lock.json .
RUN npm install

COPY jinaga.js .
COPY index.js.map .
COPY jinaga.test.js .

ENTRYPOINT [ "npm", "test" ]