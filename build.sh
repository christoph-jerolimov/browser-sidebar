#!/usr/bin/env bash
# Bundle both extensions into installable packages under dist/.
#   dist/chrome.zip   -> for chrome://extensions ("Pack extension" or store upload)
#   dist/firefox.xpi  -> for about:debugging / about:addons (see README)
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

(cd chrome && zip -r -q ../dist/chrome.zip . -x '*.DS_Store')
(cd firefox && zip -r -q ../dist/firefox.xpi . -x '*.DS_Store')

echo "Built:"
ls -lh dist
