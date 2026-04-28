import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SandboxManagerService } from './sandbox-manager.service';
import { MockProviderService } from './services/mock-provider.service';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { ResetSandboxDto } from './dto/reset-sandbox.dto';
import { SandboxStatusDto, SandboxListItemDto } from './dto/sandbox-status.dto';
import { TestDataSnapshot } from './entities/test-data-snapshot.entity';

/**
 * SandboxController
 *
 * Exposes the full lifecycle management API for developer sandboxes.
 * In production, guard this controller with an admin/developer-only guard.
 *
 * Base path: /sandbox
 */
@Controller('sandbox')
export class SandboxController {
  private readonly logger = new Logger(SandboxController.name);

  constructor(
    private readonly sandboxManager: SandboxManagerService,
    private readonly mockProvider: MockProviderService,
  ) {}

  // ─── Sandbox lifecycle ────────────────────────────────────────────────────

  /**
   * POST /sandbox
   * Create a new isolated sandbox environment.
   */
  @Post()
  async create(
    @Body() dto: CreateSandboxDto,
    @Query('ownerId') ownerId: string,
  ): Promise<SandboxStatusDto> {
    this.logger.log(`Creating sandbox "${dto.name}" for owner ${ownerId}`);
    return this.sandboxManager.create(ownerId ?? 'system', dto);
  }

  /**
   * GET /sandbox
   * List all sandboxes, optionally filtered by owner.
   */
  @Get()
  async findAll(
    @Query('ownerId') ownerId?: string,
  ): Promise<SandboxListItemDto[]> {
    return this.sandboxManager.findAll(ownerId);
  }

  /**
   * GET /sandbox/:id
   * Get status and health of a sandbox.
   */
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SandboxStatusDto> {
    return this.sandboxManager.findOne(id);
  }

  /**
   * DELETE /sandbox/:id
   * Destroy a sandbox and purge its data.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async destroy(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    this.logger.log(`Destroying sandbox ${id}`);
    return this.sandboxManager.destroy(id);
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  /**
   * POST /sandbox/:id/reset
   * Reset sandbox to a clean state using the specified strategy.
   */
  @Post(':id/reset')
  async reset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetSandboxDto,
  ): Promise<SandboxStatusDto> {
    this.logger.log(`Resetting sandbox ${id} with strategy "${dto.strategy}"`);
    return this.sandboxManager.reset(id, dto);
  }

  // ─── Clone ────────────────────────────────────────────────────────────────

  /**
   * POST /sandbox/:id/clone
   * Fork an existing sandbox into a new environment.
   */
  @Post(':id/clone')
  async clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; ownerId?: string; copyData?: boolean },
  ): Promise<SandboxStatusDto> {
    this.logger.log(`Cloning sandbox ${id} → "${body.name}"`);
    return this.sandboxManager.cloneSandbox(
      id,
      body.name,
      body.ownerId ?? 'system',
      body.copyData ?? false,
    );
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  /**
   * GET /sandbox/:id/snapshots
   * List all data snapshots for a sandbox.
   */
  @Get(':id/snapshots')
  async listSnapshots(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestDataSnapshot[]> {
    return this.sandboxManager.listSnapshots(id);
  }

  /**
   * DELETE /sandbox/:id/snapshots/:snapshotId
   * Delete a specific snapshot.
   */
  @Delete(':id/snapshots/:snapshotId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSnapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
  ): Promise<void> {
    return this.sandboxManager.deleteSnapshot(id, snapshotId);
  }

  // ─── Feature flags ────────────────────────────────────────────────────────

  /**
   * PATCH /sandbox/:id/flags
   * Toggle a feature flag in the sandbox.
   */
  @Patch(':id/flags')
  async setFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { flag: string; value: boolean },
  ): Promise<SandboxStatusDto> {
    return this.sandboxManager.setFeatureFlag(id, body.flag, body.value);
  }

  // ─── Mock config ──────────────────────────────────────────────────────────

  /**
   * PATCH /sandbox/:id/mock-config
   * Update the mock provider configuration for a sandbox.
   */
  @Patch(':id/mock-config')
  async setMockConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<SandboxStatusDto> {
    return this.sandboxManager.setMockConfig(id, body);
  }

  /**
   * POST /sandbox/:id/chaos
   * Toggle chaos mode on the sandbox's mock providers.
   */
  @Post(':id/chaos')
  async toggleChaos(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { enabled: boolean; failureRate?: number },
  ): Promise<{ chaosEnabled: boolean; failureRate: number }> {
    const failureRate = body.failureRate ?? 0.3;
    if (body.enabled) {
      this.mockProvider.enableChaosMode(id, failureRate);
    } else {
      this.mockProvider.disableChaosMode(id);
    }
    return { chaosEnabled: body.enabled, failureRate: body.enabled ? failureRate : 0 };
  }

  // ─── Captured data inspection ─────────────────────────────────────────────

  /**
   * GET /sandbox/:id/captured-emails
   * Inspect emails captured by the mock email service.
   */
  @Get(':id/captured-emails')
  async getCapturedEmails(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { emails: this.mockProvider.getCapturedEmails(id) };
  }

  /**
   * DELETE /sandbox/:id/captured-emails
   * Clear the mock email inbox.
   */
  @Delete(':id/captured-emails')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearEmails(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    this.mockProvider.clearCapturedEmails(id);
  }

  /**
   * GET /sandbox/:id/captured-notifications
   * Inspect notifications captured during testing.
   */
  @Get(':id/captured-notifications')
  async getCapturedNotifications(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('type') type?: string,
  ) {
    return {
      notifications: this.mockProvider.getCapturedNotifications(id, type),
    };
  }
}
