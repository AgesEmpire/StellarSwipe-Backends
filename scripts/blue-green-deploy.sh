#!/usr/bin/env bash
# ============================================================
# Blue-Green Deployment Switchover Script (#701)
#
# Usage:
#   ./scripts/blue-green-deploy.sh <environment> <new_image_tag>
#
# Example:
#   ./scripts/blue-green-deploy.sh production ghcr.io/stellarswipe/backend:v1.2.3
#
# Requirements:
#   - kubectl configured with access to the target cluster
#   - KUBECONFIG_DATA (base64) or pre-configured kubeconfig
#
# Workflow:
#   1. Detect current color (blue/green) from active service selector
#   2. Deploy new image to the INACTIVE color
#   3. Run health checks against the green (new) deployment
#   4. Switch the Service selector to green (fast, single kubectl patch)
#   5. On failure at any point → auto-rollback to blue
#
# Decommissioning old blue after successful switch:
#   kubectl scale deployment stellarswipe-blue --replicas=0 -n <namespace>
#   (or delete once you're confident green is stable)
# ============================================================
set -euo pipefail

ENVIRONMENT=${1:?Usage: blue-green-deploy.sh <environment> <new_image_tag>}
NEW_IMAGE=${2:?Usage: blue-green-deploy.sh <environment> <new_image_tag>}
NAMESPACE="stellarswipe-${ENVIRONMENT}"
SERVICE_NAME="stellarswipe-api"
HEALTH_PATH="/api/v1/health"
HEALTH_RETRIES=12          # 12 × 5s = 60 s max
HEALTH_RETRY_INTERVAL=5    # seconds between retries
ROLLOUT_TIMEOUT=300        # seconds to wait for k8s rollout

# ── Optional kubeconfig bootstrap ──────────────────────────
if [[ -n "${KUBECONFIG_DATA:-}" ]]; then
  mkdir -p ~/.kube
  echo "${KUBECONFIG_DATA}" | base64 -d > ~/.kube/config
  chmod 600 ~/.kube/config
fi

# ── Helper: detect current active color ────────────────────
get_active_color() {
  kubectl get service "${SERVICE_NAME}" \
    --namespace="${NAMESPACE}" \
    -o jsonpath='{.spec.selector.color}' 2>/dev/null || echo "blue"
}

# ── Helper: get ClusterIP of a deployment's pods ───────────
get_pod_ip() {
  local color=$1
  kubectl get pod \
    --namespace="${NAMESPACE}" \
    -l "app=stellarswipe,color=${color}" \
    -o jsonpath='{.items[0].status.podIP}' 2>/dev/null || echo ""
}

# ── Helper: health check via kubectl exec ──────────────────
health_check_green() {
  local color=$1
  echo "  Running health checks against ${color}..."

  for attempt in $(seq 1 "${HEALTH_RETRIES}"); do
    local pod_name
    pod_name=$(kubectl get pod \
      --namespace="${NAMESPACE}" \
      -l "app=stellarswipe,color=${color}" \
      --field-selector=status.phase=Running \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [[ -z "${pod_name}" ]]; then
      echo "  Attempt ${attempt}/${HEALTH_RETRIES}: no running pod yet, waiting..."
      sleep "${HEALTH_RETRY_INTERVAL}"
      continue
    fi

    local http_code
    http_code=$(kubectl exec "${pod_name}" \
      --namespace="${NAMESPACE}" \
      -- wget -qO- --server-response "http://localhost:3000${HEALTH_PATH}" 2>&1 \
      | grep "HTTP/" | awk '{print $2}' || echo "000")

    if [[ "${http_code}" == "200" ]]; then
      echo "  ✅ Health check passed (HTTP ${http_code}) on attempt ${attempt}"
      return 0
    fi

    echo "  Attempt ${attempt}/${HEALTH_RETRIES}: HTTP ${http_code}, retrying in ${HEALTH_RETRY_INTERVAL}s..."
    sleep "${HEALTH_RETRY_INTERVAL}"
  done

  echo "  ❌ Health checks failed after ${HEALTH_RETRIES} attempts"
  return 1
}

# ── Helper: switch service selector ────────────────────────
switch_traffic() {
  local target_color=$1
  echo "Switching traffic to ${target_color}..."
  kubectl patch service "${SERVICE_NAME}" \
    --namespace="${NAMESPACE}" \
    --type='json' \
    -p="[{\"op\":\"replace\",\"path\":\"/spec/selector/color\",\"value\":\"${target_color}\"}]"
  echo "  ✅ Service now routes to ${target_color}"
}

# ── Rollback helper ─────────────────────────────────────────
rollback() {
  local original_color=$1
  echo ""
  echo "⚠️  Rolling back traffic to ${original_color}..."
  kubectl patch service "${SERVICE_NAME}" \
    --namespace="${NAMESPACE}" \
    --type='json' \
    -p="[{\"op\":\"replace\",\"path\":\"/spec/selector/color\",\"value\":\"${original_color}\"}]" || true
  echo "✅ Rollback complete. Traffic restored to ${original_color}."
}

# ── Main ────────────────────────────────────────────────────
ACTIVE_COLOR=$(get_active_color)
if [[ "${ACTIVE_COLOR}" == "blue" ]]; then
  NEW_COLOR="green"
else
  NEW_COLOR="blue"
fi

echo "============================================================"
echo "Blue-Green Deployment"
echo "  Environment : ${ENVIRONMENT}"
echo "  Namespace   : ${NAMESPACE}"
echo "  New image   : ${NEW_IMAGE}"
echo "  Active color: ${ACTIVE_COLOR}"
echo "  Target color: ${NEW_COLOR}"
echo "============================================================"

# Register rollback trap
trap 'rollback "${ACTIVE_COLOR}"' ERR

# ── Step 1: Update the inactive deployment ──────────────────
DEPLOYMENT_NAME="stellarswipe-${NEW_COLOR}"
echo ""
echo "▶ Step 1: Updating deployment/${DEPLOYMENT_NAME} with new image..."
kubectl set image deployment/"${DEPLOYMENT_NAME}" \
  app="${NEW_IMAGE}" \
  --namespace="${NAMESPACE}"

echo "  Waiting for rollout..."
kubectl rollout status deployment/"${DEPLOYMENT_NAME}" \
  --namespace="${NAMESPACE}" \
  --timeout="${ROLLOUT_TIMEOUT}s"
echo "  ✅ Rollout complete"

# ── Step 2: Health checks on new color ─────────────────────
echo ""
echo "▶ Step 2: Health checking ${NEW_COLOR} before traffic switch..."
if ! health_check_green "${NEW_COLOR}"; then
  echo "❌ Health checks failed — aborting deployment. Traffic remains on ${ACTIVE_COLOR}."
  exit 1
fi

# ── Step 3: Switch traffic ──────────────────────────────────
echo ""
echo "▶ Step 3: Switching traffic..."
switch_traffic "${NEW_COLOR}"

# Disable rollback trap (deployment succeeded)
trap - ERR

echo ""
echo "============================================================"
echo "✅ Blue-green switchover complete!"
echo "   Live color : ${NEW_COLOR} (${NEW_IMAGE})"
echo "   Old color  : ${ACTIVE_COLOR} (idle — scale down when confident)"
echo ""
echo "To decommission the old ${ACTIVE_COLOR} environment:"
echo "  kubectl scale deployment stellarswipe-${ACTIVE_COLOR} --replicas=0 -n ${NAMESPACE}"
echo "============================================================"
