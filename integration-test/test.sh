#!/bin/bash
npm run build

cp ../dist/index.js ./jinaga-test/jinaga.js
cp ../dist/index.js.map ./jinaga-test/

npm --prefix ./integration-test/jinaga-test install
npm --prefix ./integration-test/jinaga-test run test:verbose
