#!/bin/bash
npm run build

cp ./dist/index.js ./integration-test/jinaga-test/jinaga.js
cp ./dist/index.js.map ./integration-test/jinaga-test/

npm --prefix ./integration-test/jinaga-test install
npm --prefix ./integration-test/jinaga-test run test:verbose
