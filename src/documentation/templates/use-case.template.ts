export interface UseCase {
  title: string;
  description: string;
  steps: { description: string; request?: string; response?: string }[];
}

const USE_CASES: UseCase[] = [
  {
    title: 'Copy a Signal from a Top Provider',
    description: 'Find an active signal and execute a copy trade in one flow.',
    steps: [
      {
        description: 'List active signals sorted by confidence',
        request: 'GET /api/v2/signals?status=ACTIVE&sortBy=confidence&order=desc&limit=5',
        response: '[ { "id": "uuid", "assetPair": "USDC/XLM", "type": "BUY", "confidenceScore": 90 } ]',
      },
      {
        description: 'Validate the trade before committing',
        request: 'POST /api/v2/trades/validate\n{ "userId": "uuid", "signalId": "uuid", "amount": 50 }',
        response: '{ "valid": true, "estimatedCost": 50.25, "priceImpact": 0.001 }',
      },
      {
        description: 'Execute the trade',
        request: 'POST /api/v2/trades/execute\n{ "userId": "uuid", "signalId": "uuid", "amount": 50 }',
        response: '{ "id": "trade-uuid", "status": "OPEN", "entryPrice": "0.1234" }',
      },
    ],
  },
  {
    title: 'Rebalance Portfolio to Target Allocation',
    description: 'Set a target allocation and generate a rebalancing plan.',
    steps: [
      {
        description: 'Set target allocation',
        request: 'POST /api/v2/portfolio/rebalancing/target?userId=uuid\n{ "allocations": [{ "assetCode": "XLM", "targetPercentage": 60 }, { "assetCode": "USDC", "targetPercentage": 40 }] }',
      },
      {
        description: 'Analyse current drift',
        request: 'GET /api/v2/portfolio/rebalancing/drift?userId=uuid',
        response: '{ "requiresRebalancing": true, "totalDrift": 12.5 }',
      },
      {
        description: 'Generate and execute rebalancing plan',
        request: 'POST /api/v2/portfolio/rebalancing/plan?userId=uuid&autoExecute=true',
        response: '{ "id": "plan-uuid", "status": "EXECUTED", "trades": [...] }',
      },
    ],
  },
];

export function renderUseCaseTemplate(): string {
  const lines: string[] = ['# Use Cases\n'];

  USE_CASES.forEach((uc, i) => {
    lines.push(`## ${i + 1}. ${uc.title}\n`);
    lines.push(`${uc.description}\n`);
    uc.steps.forEach((step, j) => {
      lines.push(`### Step ${j + 1}: ${step.description}\n`);
      if (step.request) {
        lines.push('**Request:**\n```\n' + step.request + '\n```\n');
      }
      if (step.response) {
        lines.push('**Response:**\n```json\n' + step.response + '\n```\n');
      }
    });
  });

  return lines.join('\n');
}
