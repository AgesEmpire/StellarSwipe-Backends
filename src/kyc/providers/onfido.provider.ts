import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface OnfidoApplicantSession {
  applicantId: string;
  workflowRunId: string;
  sdkToken: string;
}

export interface OnfidoVerificationResult {
  checkId: string;
  applicantId: string;
  workflowRunId: string;
  status: 'approved' | 'declined' | 'needs_review' | 'pending';
  result: 'clear' | 'consider' | null;
  declinedReasons: string[];
  completedAt: string | null;
  providerMetadata: Record<string, unknown>;
}

/**
 * Onfido KYC Provider
 *
 * Docs: https://documentation.onfido.com/
 *
 * Required env vars:
 *   ONFIDO_API_TOKEN       - Onfido API token
 *   ONFIDO_WORKFLOW_ID     - Workflow ID from Onfido Studio
 *   ONFIDO_WEBHOOK_TOKEN   - Webhook token for signature verification
 *   ONFIDO_REGION          - 'EU', 'US', or 'CA' (defaults to 'EU')
 */
@Injectable()
export class OnfidoProvider {
  private readonly logger = new Logger(OnfidoProvider.name);
  private readonly apiToken: string;
  private readonly workflowId: string;
  private readonly webhookToken: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiToken = this.config.getOrThrow<string>('ONFIDO_API_TOKEN');
    this.workflowId = this.config.getOrThrow<string>('ONFIDO_WORKFLOW_ID');
    this.webhookToken = this.config.getOrThrow<string>('ONFIDO_WEBHOOK_TOKEN');

    const region = this.config.get<string>('ONFIDO_REGION', 'EU').toUpperCase();
    const regionUrls: Record<string, string> = {
      EU: 'https://api.eu.onfido.com/v3.6',
      US: 'https://api.us.onfido.com/v3.6',
      CA: 'https://api.ca.onfido.com/v3.6',
    };
    this.baseUrl = regionUrls[region] ?? regionUrls['EU'];
  }

  // ─── Create Applicant + Workflow Run ─────────────────────────────────────

  /**
   * Creates an Onfido applicant and starts a workflow run.
   * Returns the SDK token needed to launch the Onfido SDK on the client.
   *
   * POST /applicants  → POST /workflow_runs  → POST /sdk_token
   */
  async createApplicantSession(
    userId: string,
  ): Promise<OnfidoApplicantSession> {
    // 1. Create applicant
    const applicant = await this.request('POST', '/applicants', {
      first_name: 'Pending',
      last_name: 'Verification',
      // Map userId as external ID for correlation
      metadata: [{ id: 'userId', value: userId }],
    });

    // 2. Start workflow run
    const workflowRun = await this.request('POST', '/workflow_runs', {
      applicant_id: applicant.id,
      workflow_id: this.workflowId,
    });

    // 3. Generate SDK token (short-lived, 90 minutes)
    const sdkTokenResp = await this.request('POST', '/sdk_token', {
      applicant_id: applicant.id,
      referrer: '*://*/*', // restrict in production to your domain
    });

    this.logger.log(
      `Onfido applicant created: ${applicant.id}, workflow run: ${workflowRun.id}`,
    );

    return {
      applicantId: applicant.id,
      workflowRunId: workflowRun.id,
      sdkToken: sdkTokenResp.token,
    };
  }

  // ─── Get Workflow Run Status ──────────────────────────────────────────────

  async getWorkflowRun(
    workflowRunId: string,
  ): Promise<OnfidoVerificationResult> {
    const run = await this.request('GET', `/workflow_runs/${workflowRunId}`);
    return this.mapWorkflowRunToResult(run);
  }

  // ─── Webhook Signature Verification ──────────────────────────────────────

  /**
   * Verifies the Onfido webhook HMAC-SHA256 signature.
   * Onfido sends the signature in the `X-SHA2-Signature` header.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    try {
      const expected = crypto
        .createHmac('sha256', this.webhookToken)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signatureHeader, 'hex'),
      );
    } catch {
      return false;
    }
  }

  // ─── Parse Webhook Payload ────────────────────────────────────────────────

  parseWebhookPayload(
    payload: Record<string, unknown>,
  ): OnfidoVerificationResult {
    const resource = (payload as any)?.resource_type;
    if (resource !== 'workflow_run') {
      throw new BadRequestException(
        `Unsupported Onfido webhook resource: ${resource}`,
      );
    }

    return this.mapWorkflowRunToResult((payload as any).object);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private mapWorkflowRunToResult(run: any): OnfidoVerificationResult {
    const statusMap: Record<string, OnfidoVerificationResult['status']> = {
      approved: 'approved',
      declined: 'declined',
      review: 'needs_review',
      awaiting_input: 'pending',
      processing: 'pending',
      error: 'declined',
    };

    const reasons: string[] = [];
    if (run?.output?.reasons) reasons.push(...run.output.reasons);

    return {
      checkId: run?.id ?? '',
      applicantId: run?.applicant_id ?? '',
      workflowRunId: run?.id ?? '',
      status: statusMap[run?.status] ?? 'pending',
      result: run?.output?.result ?? null,
      declinedReasons: reasons,
      completedAt: run?.completed_at ?? null,
      providerMetadata: {
        workflowId: run?.workflow_id,
        status: run?.status,
        output: run?.output ?? {},
      },
    };
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Token token=${this.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(
        `Onfido API error ${response.status}: ${JSON.stringify(error)}`,
      );
      throw new BadRequestException(
        `Onfido API error: ${(error as any)?.error?.message ?? response.statusText}`,
      );
    }

    return response.json();
  }
}
