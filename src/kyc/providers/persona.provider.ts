import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface PersonaInquirySession {
  inquiryId: string;
  sessionToken: string;
  widgetUrl: string;
}

export interface PersonaVerificationResult {
  inquiryId: string;
  verificationId: string;
  status: 'approved' | 'declined' | 'needs_review' | 'pending';
  declinedReasons: string[];
  referenceId: string | null; // our userId
  completedAt: string | null;
  providerMetadata: Record<string, unknown>;
}

/**
 * Persona KYC Provider
 *
 * Docs: https://docs.withpersona.com/reference
 *
 * Required env vars:
 *   PERSONA_API_KEY     - your Persona API key
 *   PERSONA_TEMPLATE_ID - inquiry template ID from Persona dashboard
 *   PERSONA_WEBHOOK_SECRET - webhook signing secret
 *   PERSONA_BASE_URL    - defaults to https://withpersona.com/api/v1
 */
@Injectable()
export class PersonaProvider {
  private readonly logger = new Logger(PersonaProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly templateId: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.getOrThrow<string>('PERSONA_API_KEY');
    this.templateId = this.config.getOrThrow<string>('PERSONA_TEMPLATE_ID');
    this.webhookSecret = this.config.getOrThrow<string>(
      'PERSONA_WEBHOOK_SECRET',
    );
    this.baseUrl = this.config.get<string>(
      'PERSONA_BASE_URL',
      'https://withpersona.com/api/v1',
    );
  }

  // ─── Create Inquiry ──────────────────────────────────────────────────────

  /**
   * Creates a new Persona inquiry and returns the session token
   * needed to initialise the embedded widget on the client side.
   *
   * POST /inquiries
   * https://docs.withpersona.com/reference/create-an-inquiry
   */
  async createInquiry(
    userId: string,
    targetLevel: number,
    redirectUrl?: string,
  ): Promise<PersonaInquirySession> {
    const body = {
      data: {
        type: 'inquiry',
        attributes: {
          'inquiry-template-id': this.templateId,
          'reference-id': userId,
          note: `KYC Level ${targetLevel} verification`,
          ...(redirectUrl ? { 'redirect-uri': redirectUrl } : {}),
        },
      },
    };

    const response = await this.request('POST', '/inquiries', body);
    const { id, attributes } = response.data;

    this.logger.log(`Persona inquiry created: ${id} for user ${userId}`);

    return {
      inquiryId: id,
      sessionToken: attributes['session-token'],
      widgetUrl: `https://withpersona.com/verify?inquiry-id=${id}&session-token=${attributes['session-token']}`,
    };
  }

  // ─── Resume Inquiry Session ───────────────────────────────────────────────

  /**
   * Generates a fresh session token for a previously created inquiry.
   * Used when a user needs to return to complete their verification.
   *
   * POST /inquiries/{id}/resume
   */
  async resumeInquiry(inquiryId: string): Promise<string> {
    const response = await this.request(
      'POST',
      `/inquiries/${inquiryId}/resume`,
      {},
    );
    return response.data.attributes['session-token'];
  }

  // ─── Fetch Inquiry Status ─────────────────────────────────────────────────

  /**
   * Retrieves the current status of an inquiry from Persona.
   * Called during webhook processing to get the full verification result.
   *
   * GET /inquiries/{id}
   */
  async getInquiry(inquiryId: string): Promise<PersonaVerificationResult> {
    const response = await this.request('GET', `/inquiries/${inquiryId}`);
    return this.mapInquiryToResult(response.data);
  }

  // ─── Webhook Signature Verification ──────────────────────────────────────

  /**
   * Verifies the Persona webhook HMAC-SHA256 signature.
   * Persona sends the signature in the `Persona-Signature` header.
   *
   * Format: "t=<timestamp>,v1=<hex_signature>"
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    try {
      const parts = Object.fromEntries(
        signatureHeader.split(',').map((part) => {
          const [k, v] = part.split('=');
          return [k, v];
        }),
      );

      const timestamp = parts['t'];
      const receivedSig = parts['v1'];

      if (!timestamp || !receivedSig) return false;

      // Replay attack prevention — reject webhooks older than 5 minutes
      const webhookAge = Date.now() / 1000 - parseInt(timestamp, 10);
      if (webhookAge > 300) {
        this.logger.warn(
          'Persona webhook timestamp too old — possible replay attack',
        );
        return false;
      }

      const signedPayload = `${timestamp}.${rawBody}`;
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signedPayload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(receivedSig, 'hex'),
      );
    } catch {
      return false;
    }
  }

  // ─── Parse Webhook Payload ────────────────────────────────────────────────

  parseWebhookPayload(
    payload: Record<string, unknown>,
  ): PersonaVerificationResult {
    const eventName = (payload as any)?.data?.attributes?.name as string;
    const inquiry = (payload as any)?.data?.attributes?.payload?.data;

    if (!inquiry) {
      throw new BadRequestException(
        'Invalid Persona webhook payload structure',
      );
    }

    return this.mapInquiryToResult(inquiry);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private mapInquiryToResult(data: any): PersonaVerificationResult {
    const attr = data?.attributes ?? {};

    const rawStatus: string = attr.status ?? 'pending';
    const statusMap: Record<string, PersonaVerificationResult['status']> = {
      approved: 'approved',
      declined: 'declined',
      failed: 'declined',
      needs_review: 'needs_review',
      pending: 'pending',
      created: 'pending',
      completed: 'approved',
    };

    return {
      inquiryId: data.id,
      verificationId: attr['verification-id'] ?? data.id,
      status: statusMap[rawStatus] ?? 'pending',
      declinedReasons: attr['declined-reasons'] ?? [],
      referenceId: attr['reference-id'] ?? null,
      completedAt: attr['completed-at'] ?? null,
      providerMetadata: {
        templateId: attr['inquiry-template-id'],
        sessionToken: undefined, // never store tokens
        rawStatus,
        fields: attr.fields ?? {},
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
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Persona-Version': '2023-01-05',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(
        `Persona API error ${response.status}: ${JSON.stringify(error)}`,
      );
      throw new BadRequestException(
        `Persona API error: ${(error as any)?.errors?.[0]?.detail ?? response.statusText}`,
      );
    }

    return response.json();
  }
}
