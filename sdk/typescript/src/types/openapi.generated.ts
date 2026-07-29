/**
 * This file is AUTO-GENERATED from docs/generated/openapi.json.
 * Do NOT edit by hand — run `npm run sdk:generate-types` to regenerate.
 *
 * If CI reports SDK type drift:
 *   1. npm run export:openapi        # re-export the spec from the running app
 *   2. npm run sdk:generate-types    # regenerate this file
 *   3. git add sdk/typescript/src/types/openapi.generated.ts
 *   4. git commit -m 'chore(sdk): regenerate types from updated OpenAPI spec'
 */

// Generated from: docs/generated/openapi.json
// Spec version:   1.0

export interface paths {
  '/signals': {
    get: operations['SignalsController_getSignals'];
  };
  '/soroban/simulate': {
    post: operations['SorobanController_simulate'];
  };
}

export interface components {
  schemas: {
    SimulateContractDto: {
      contractId: string;
      method: string;
      params?: unknown[];
      sourceAccount?: string;
      sourceSecret?: string;
      timeoutMs?: number;
    };
    SimulateContractResponseDto: {
      success: boolean;
      resourceFee?: string;
      minResourceFee?: string;
      inclusionFee?: string;
      totalFee?: string;
      result?: unknown;
      footprint?: {
        readOnly?: string[];
        readWrite?: string[];
      };
      auth?: string[];
      simulationError?: string;
      rpcError?: string;
    };
  };
}

export interface operations {
  SignalsController_getSignals: {
    responses: {
      200: {
        description: 'OK';
      };
    };
  };
  SorobanController_simulate: {
    requestBody: {
      content: {
        'application/json': components['schemas']['SimulateContractDto'];
      };
    };
    responses: {
      200: {
        content: {
          'application/json': components['schemas']['SimulateContractResponseDto'];
        };
        description: 'Simulation result (check `success` field)';
      };
    };
  };
}
