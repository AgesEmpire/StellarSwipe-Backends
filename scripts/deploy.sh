#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT=${1:?Usage: deploy.sh <environment> <image_tag>}
IMAGE_TAG=${2:?Usage: deploy.sh <environment> <image_tag>}
REGISTRY="ghcr.io"
REPO="${GITHUB_REPOSITORY:-stellarswipe/stellarswipe-backends}"
IMAGE="${REGISTRY}/${REPO}:${IMAGE_TAG}"

echo "▶ Deploying ${IMAGE} to ${ENVIRONMENT}"

# Write kubeconfig from secret
mkdir -p ~/.kube
echo "${KUBECONFIG_DATA}" | base64 -d > ~/.kube/config
chmod 600 ~/.kube/config

NAMESPACE="stellarswipe-${ENVIRONMENT}"

# Update the deployment image
kubectl set image deployment/stellarswipe-api \
  app="${IMAGE}" \
  --namespace="${NAMESPACE}"

# Wait for rollout
kubectl rollout status deployment/stellarswipe-api \
  --namespace="${NAMESPACE}" \
  --timeout=300s

echo "✅ Deployment to ${ENVIRONMENT} complete"
