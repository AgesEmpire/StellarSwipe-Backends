#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT=${1:?Usage: rollback.sh <environment> <image_tag>}
IMAGE_TAG=${2:?Usage: rollback.sh <environment> <image_tag>}
REGISTRY="ghcr.io"
REPO="${GITHUB_REPOSITORY:-stellarswipe/stellarswipe-backends}"
IMAGE="${REGISTRY}/${REPO}:${IMAGE_TAG}"

echo "⏪ Rolling back ${ENVIRONMENT} to ${IMAGE}"

# Write kubeconfig from secret
mkdir -p ~/.kube
echo "${KUBECONFIG_DATA}" | base64 -d > ~/.kube/config
chmod 600 ~/.kube/config

NAMESPACE="stellarswipe-${ENVIRONMENT}"

kubectl set image deployment/stellarswipe-api \
  app="${IMAGE}" \
  --namespace="${NAMESPACE}"

kubectl rollout status deployment/stellarswipe-api \
  --namespace="${NAMESPACE}" \
  --timeout=300s

echo "✅ Rollback to ${IMAGE_TAG} on ${ENVIRONMENT} complete"
