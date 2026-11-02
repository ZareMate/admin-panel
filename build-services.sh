#!/usr/bin/env bash
set -euo pipefail

PROJECT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for service in web-server discord-bot; do
    echo "Installing and building $service..."
    (cd -- "$PROJECT/$service" && npm ci && npm run build)
done

echo "Web server and Discord bot installs and builds complete."
