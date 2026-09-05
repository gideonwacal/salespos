#!/usr/bin/env bash
# Render build step. `set -o errexit` matters: without it a failed migration
# still deploys, and the app comes up against a half-built schema.
set -o errexit

pip install --upgrade pip
pip install -r requirements.txt

# Collect admin/DRF assets for WhiteNoise to serve.
python manage.py collectstatic --no-input

# Apply migrations at build time, so the release is never newer than its schema.
python manage.py migrate
