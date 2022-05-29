FROM node:alpine3.12

WORKDIR /root

COPY package.json .
COPY package-lock.json .
RUN npm install

COPY jinaga/ jinaga/
COPY jinaga.test.js .

ENTRYPOINT [ "npm", "test" ]