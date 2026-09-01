#!/bin/sh
# Writes the runtime configuration read by index.html before the app bundle
# loads. Vite bakes VITE_* variables into the bundle at build time, so this is
# what lets a prebuilt image pick up the API URL from the platform environment
# (Dokploy, Coolify, docker run -e ...) at container start.
#
# Installed into /docker-entrypoint.d/, which the official nginx image runs
# before starting nginx — so it must not exec the server itself.
set -eu

CONFIG_FILE="/usr/share/nginx/html/config.js"

# VITE_API_BASE_URL is the documented name; API_BASE_URL is accepted as an alias.
API_URL="${VITE_API_BASE_URL:-${API_BASE_URL:-}}"

# Escape characters that would break out of the JS string literal.
ESCAPED_API_URL=$(printf '%s' "$API_URL" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

cat > "$CONFIG_FILE" <<EOF
window.__APP_CONFIG__ = {
  VITE_API_BASE_URL: "${ESCAPED_API_URL}",
};
EOF

if [ -n "$API_URL" ]; then
  echo "[entrypoint] API base URL: $API_URL"
else
  echo "[entrypoint] VITE_API_BASE_URL not set; the app will call /api on this origin."
fi
