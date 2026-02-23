import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentUpdateDto } from './dto/incident-update.dto';

@Controller('incidents')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Post()
  create(@Body() createDto: CreateIncidentDto) {
    return this.incidentService.create(createDto);
  }

  @Get()
  findAll() {
    return this.incidentService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.incidentService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: IncidentUpdateDto) {
    return this.incidentService.update(id, updateDto);
  }

  @Get(':id/post-mortem')
  generatePostMortem(@Param('id') id: string) {
    return this.incidentService.generatePostMortem(id);
  }
}
