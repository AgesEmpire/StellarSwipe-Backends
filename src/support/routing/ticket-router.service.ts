import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTeam } from './entities/support-team.entity';
import { RoutingRule } from './entities/routing-rule.entity';
import { CreateRoutingRuleDto, UpdateRoutingRuleDto, CreateSupportTeamDto } from './dto/routing-config.dto';
import { TicketRoutingRequestDto, TeamAssignment } from './dto/team-assignment.dto';
import { TeamMatcher } from './utils/team-matcher';
import { AvailabilityChecker } from './utils/availability-checker';

@Injectable()
export class TicketRouterService {
  constructor(
    @InjectRepository(SupportTeam)
    private teamRepository: Repository<SupportTeam>,
    @InjectRepository(RoutingRule)
    private ruleRepository: Repository<RoutingRule>,
    private teamMatcher: TeamMatcher,
    private availabilityChecker: AvailabilityChecker,
  ) {}

  async routeTicket(dto: TicketRoutingRequestDto): Promise<TeamAssignment> {
    const allTeams = await this.teamRepository.find({ where: { isActive: true } });
    const availableTeams = this.availabilityChecker.filterAvailable(allTeams);

    if (availableTeams.length === 0) {
      throw new NotFoundException('No available support teams found');
    }

    const context = {
      language: dto.language,
      region: dto.region,
      timezone: dto.timezone,
      requiredSkills: dto.requiredSkills,
    };

    const rules = await this.ruleRepository.find({
      where: { isActive: true },
      relations: ['targetTeam'],
      order: { priority: 'DESC' },
    });

    for (const rule of rules) {
      if (this.ruleMatches(rule, dto) && this.availabilityChecker.isTeamAvailable(rule.targetTeam)) {
        return this.buildAssignment(dto.ticketId, rule.targetTeam, rule.id, rule.ruleType);
      }
    }

    const best = this.teamMatcher.findBestMatch(availableTeams, context);
    if (!best) throw new NotFoundException('Could not find a suitable team');

    return this.buildAssignment(dto.ticketId, best.team, null, 'composite_score');
  }

  private ruleMatches(rule: RoutingRule, dto: TicketRoutingRequestDto): boolean {
    const conditions = rule.conditions as Record<string, unknown>;
    if (conditions['language'] && conditions['language'] !== dto.language) return false;
    if (conditions['region'] && conditions['region'] !== dto.region) return false;
    if (conditions['skill'] && !dto.requiredSkills?.includes(conditions['skill'] as string)) return false;
    return true;
  }

  private buildAssignment(
    ticketId: string,
    team: SupportTeam,
    ruleId: string | null,
    strategy: string,
  ): TeamAssignment {
    return {
      ticketId,
      teamId: team.id,
      teamName: team.name,
      assignedAt: new Date(),
      routingRuleId: ruleId,
      routingStrategy: strategy,
      confidence: 1,
    };
  }

  async createTeam(dto: CreateSupportTeamDto): Promise<SupportTeam> {
    const team = this.teamRepository.create(dto);
    return this.teamRepository.save(team);
  }

  async updateTeam(id: string, dto: Partial<CreateSupportTeamDto>): Promise<SupportTeam> {
    const team = await this.teamRepository.findOne({ where: { id } });
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    Object.assign(team, dto);
    return this.teamRepository.save(team);
  }

  async findAllTeams(): Promise<SupportTeam[]> {
    return this.teamRepository.find({ order: { region: 'ASC', name: 'ASC' } });
  }

  async createRule(dto: CreateRoutingRuleDto): Promise<RoutingRule> {
    const rule = this.ruleRepository.create(dto);
    return this.ruleRepository.save(rule);
  }

  async updateRule(id: string, dto: UpdateRoutingRuleDto): Promise<RoutingRule> {
    const rule = await this.ruleRepository.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Rule ${id} not found`);
    Object.assign(rule, dto);
    return this.ruleRepository.save(rule);
  }

  async findAllRules(): Promise<RoutingRule[]> {
    return this.ruleRepository.find({ relations: ['targetTeam'], order: { priority: 'DESC' } });
  }
}
