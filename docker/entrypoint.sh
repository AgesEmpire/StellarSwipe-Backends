#!/bin/sh
set -e

# Run migrations before starting the app
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  npm run migration:run
fi

exec "$@"
