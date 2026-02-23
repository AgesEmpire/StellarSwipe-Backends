import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { SlaMonitorService, SlaThreshold } from './sla-monitor.service';
import { SlaReporterService } from './sla-reporter.service';

@Controller('sla')
export class SlaController {
  constructor(
    private readonly slaMonitorService: SlaMonitorService,
    private readonly slaReporterService: SlaReporterService,
  ) {}

  @Get('dashboard')
  async getDashboard(@Query('hours') hours: string = '24') {
    const services = ['api', 'database'];
    return this.slaReporterService.getDashboardData(services, parseInt(hours));
  }

  @Get('report/:service')
  async getReport(
    @Param('service') service: string,
    @Query('hours') hours: string = '24',
  ) {
    return this.slaReporterService.generateReport(service, parseInt(hours));
  }

  @Get('uptime/:service')
  async getUptime(
    @Param('service') service: string,
    @Query('hours') hours: string = '24',
  ) {
    const uptime = await this.slaMonitorService.calculateUptime(service, parseInt(hours));
    return { service, uptime, hours: parseInt(hours) };
  }

  @Get('response-time/:service')
  async getResponseTime(
    @Param('service') service: string,
    @Query('hours') hours: string = '24',
  ) {
    const avgResponseTime = await this.slaMonitorService.getAverageResponseTime(
      service,
      parseInt(hours),
    );
    return { service, avgResponseTime, hours: parseInt(hours) };
  }

  @Get('breaches/:service')
  async getBreaches(
    @Param('service') service: string,
    @Query('hours') hours: string = '24',
  ) {
    return this.slaMonitorService.getBreaches(service, parseInt(hours));
  }

  @Post('threshold/:service')
  async setThreshold(
    @Param('service') service: string,
    @Body() threshold: SlaThreshold,
  ) {
    this.slaMonitorService.setThreshold(service, threshold);
    return { message: 'Threshold updated', service, threshold };
  }

  @Get('threshold/:service')
  async getThreshold(@Param('service') service: string) {
    return this.slaMonitorService.getThreshold(service);
  }

  @Post('check/:service')
  async checkService(@Param('service') service: string) {
    const result = await this.slaMonitorService.checkService(service, async () => {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      return Date.now();
    });
    return result;
  }
}
