#!/bin/bash
docker build -t jinaga-postgres-fact-keystore ./postgres

cp ../dist/index.js ./jinaga-test/jinaga.js
cp ../dist/index.js.map ./jinaga-test/
docker build -t jinaga-test ./jinaga-test

docker compose up --exit-code-from jinaga-test --renew-anon-volumes
docker compose down -v