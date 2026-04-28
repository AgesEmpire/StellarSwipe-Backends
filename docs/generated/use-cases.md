# Use Cases

## 1. Copy a Signal from a Top Provider

Find an active signal and execute a copy trade in one flow.

### Step 1: List active signals sorted by confidence

**Request:**
```
GET /api/v2/signals?status=ACTIVE&sortBy=confidence&order=desc&limit=5
```

**Response:**
```json
[ { "id": "uuid", "assetPair": "USDC/XLM", "type": "BUY", "confidenceScore": 90 } ]
```

### Step 2: Validate the trade before committing

**Request:**
```
POST /api/v2/trades/validate
{ "userId": "uuid", "signalId": "uuid", "amount": 50 }
```

**Response:**
```json
{ "valid": true, "estimatedCost": 50.25, "priceImpact": 0.001 }
```

### Step 3: Execute the trade

**Request:**
```
POST /api/v2/trades/execute
{ "userId": "uuid", "signalId": "uuid", "amount": 50 }
```

**Response:**
```json
{ "id": "trade-uuid", "status": "OPEN", "entryPrice": "0.1234" }
```

## 2. Rebalance Portfolio to Target Allocation

Set a target allocation and generate a rebalancing plan.

### Step 1: Set target allocation

**Request:**
```
POST /api/v2/portfolio/rebalancing/target?userId=uuid
{ "allocations": [{ "assetCode": "XLM", "targetPercentage": 60 }, { "assetCode": "USDC", "targetPercentage": 40 }] }
```

### Step 2: Analyse current drift

**Request:**
```
GET /api/v2/portfolio/rebalancing/drift?userId=uuid
```

**Response:**
```json
{ "requiresRebalancing": true, "totalDrift": 12.5 }
```

### Step 3: Generate and execute rebalancing plan

**Request:**
```
POST /api/v2/portfolio/rebalancing/plan?userId=uuid&autoExecute=true
```

**Response:**
```json
{ "id": "plan-uuid", "status": "EXECUTED", "trades": [...] }
```
