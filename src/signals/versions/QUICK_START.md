# Signal Versioning - Quick Start Guide

## Overview
Signal versioning allows providers to update their trading signals while maintaining a complete, immutable history of all changes.

## For Providers

### Update a Signal
```bash
curl -X PATCH http://localhost:3000/api/v1/signals/{signalId}/update \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetPrice": "150.00",
    "stopLossPrice": "85.00",
    "rationale": "Updated based on market analysis",
    "requiresApproval": false
  }'
```

**Response:**
```json
{
  "signalId": "uuid",
  "newVersion": 2,
  "requiresApproval": false,
  "changeSummary": "Target: 120 → 150; Stop Loss: 90 → 85",
  "copiersNotified": 15
}
```

### View Version History
```bash
curl http://localhost:3000/api/v1/signals/{signalId}/versions
```

## For Copiers

### View Pending Updates
```bash
curl http://localhost:3000/api/v1/signals/pending-approvals \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Approve/Reject Update
```bash
curl -X POST http://localhost:3000/api/v1/signals/versions/{versionId}/respond \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "autoAdjust": true
  }'
```

### Check Copied Version
```bash
curl http://localhost:3000/api/v1/signals/{signalId}/copied-version \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Restrictions

- **Maximum Updates**: 5 per signal
- **Cooldown**: 1 hour between updates
- **Status**: Only active signals can be updated
- **Immutable**: Asset pair and signal type cannot change

## Error Codes

- `404`: Signal not found
- `403`: Not signal owner
- `400`: Invalid update (inactive, expired, max updates, cooldown)
