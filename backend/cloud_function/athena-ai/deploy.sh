#!/usr/bin/env bash
# Deploys the Athena AI Cloud Function (Gen 2) using Application Default Credentials.
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="${GCP_PROJECT_ID:-vivid-spot-480905-a4}"
REGION="${VERTEX_LOCATION:-us-central1}"
NAME="${FUNCTION_NAME:-athena-ai}"
ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-*}"

echo "==> Deploying $NAME to $PROJECT / $REGION"

ENV_VARS="GCP_PROJECT_ID=$PROJECT,VERTEX_LOCATION=$REGION,CORS_ALLOWED_ORIGINS=$ALLOWED_ORIGINS"
if [[ -n "${ATHENA_SHARED_SECRET:-}" ]]; then
  ENV_VARS="$ENV_VARS,ATHENA_SHARED_SECRET=$ATHENA_SHARED_SECRET"
fi

gcloud functions deploy "$NAME" \
  --gen2 \
  --runtime=nodejs22 \
  --region="$REGION" \
  --source=. \
  --entry-point=athenaAi \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512Mi \
  --timeout=120s \
  --max-instances=10 \
  --set-env-vars="$ENV_VARS" \
  --project="$PROJECT"

echo
echo "==> Function URL:"
gcloud functions describe "$NAME" --gen2 --region="$REGION" --project="$PROJECT" --format='value(serviceConfig.uri)'
