#!/bin/bash
set -e

# The parameter must be patch, minor or major
if [ "$1" != "patch" ] && [ "$1" != "minor" ] && [ "$1" != "major" ]; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

git c main
git pull
npm version $1
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes --verify-tag
