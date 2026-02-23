import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentStatus } from './entities/incident.entity';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentUpdateDto } from './dto/incident-update.dto';

@Injectable()
export class IncidentService {
  constructor(
    @InjectRepository(Incident)
    private incidentRepository: Repository<Incident>,
  ) {}

  async create(createDto: CreateIncidentDto): Promise<Incident> {
    const incident = this.incidentRepository.create({
      ...createDto,
      timeline: [{
        timestamp: new Date(),
        status: IncidentStatus.INVESTIGATING,
        message: 'Incident created',
      }],
    });
    return this.incidentRepository.save(incident);
  }

  async findAll(): Promise<Incident[]> {
    return this.incidentRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Incident> {
    const incident = await this.incidentRepository.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  async update(id: string, updateDto: IncidentUpdateDto): Promise<Incident> {
    const incident = await this.findOne(id);
    
    if (updateDto.status) {
      incident.timeline.push({
        timestamp: new Date(),
        status: updateDto.status,
        message: updateDto.message || `Status changed to ${updateDto.status}`,
      });
      incident.status = updateDto.status;
      if (updateDto.status === IncidentStatus.RESOLVED) {
        incident.resolvedAt = new Date();
      }
    }

    if (updateDto.postMortem) incident.postMortem = updateDto.postMortem;
    if (updateDto.publishedToStatusPage !== undefined) {
      incident.publishedToStatusPage = updateDto.publishedToStatusPage;
    }

    return this.incidentRepository.save(incident);
  }

  async generatePostMortem(id: string): Promise<string> {
    const incident = await this.findOne(id);
    
    const duration = incident.resolvedAt 
      ? Math.round((incident.resolvedAt.getTime() - incident.createdAt.getTime()) / 60000)
      : 'Ongoing';

    return `# Post-Mortem: ${incident.title}

## Summary
${incident.description}

## Severity
${incident.severity.toUpperCase()}

## Timeline
${incident.timeline.map(t => `- ${new Date(t.timestamp).toISOString()}: ${t.message}`).join('\n')}

## Duration
${duration} minutes

## Status
${incident.status}

## Root Cause
[To be filled]

## Resolution
[To be filled]

## Action Items
[To be filled]`;
  }
}
