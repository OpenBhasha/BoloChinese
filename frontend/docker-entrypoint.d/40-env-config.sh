#!/bin/sh
# Runs automatically before nginx starts (nginx's own official image sources every
# executable *.sh file in /docker-entrypoint.d/). Writes the API base URL from this
# container's actual runtime environment — set in Dokploy's Environment tab, or via
# `docker run -e VITE_API_BASE_URL=...` — since Vite can only inline it at build
# time, and the image is built once and deployed with different URLs per environment.
set -e

: "${VITE_API_BASE_URL:=http://localhost:5000/api}"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__ENV__ = {
  VITE_API_BASE_URL: "${VITE_API_BASE_URL}"
};
EOF
