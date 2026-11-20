import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TaxJurisdiction,
  TaxJurisdictionConfiguration,
  TaxMappingSet,
} from './tax-report.types';

@Injectable()
export class TaxReportConfigurationService {
  private readonly jurisdictionConfigurations: TaxJurisdictionConfiguration[] = [];
  private readonly mappingSets: TaxMappingSet[] = [];

  addJurisdictionConfiguration(
    configuration: TaxJurisdictionConfiguration,
  ): void {
    this.validatePeriod(configuration.effectiveFrom, configuration.effectiveTo);
    if (!configuration.version?.trim()) {
      throw new BadRequestException(
        'Jurisdiction configuration version is required',
      );
    }

    if (
      this.jurisdictionConfigurations.some(
        existing =>
          existing.jurisdiction === configuration.jurisdiction &&
          this.periodsOverlap(existing, configuration),
      )
    ) {
      throw new BadRequestException(
        `Jurisdiction configurations overlap for ${configuration.jurisdiction}`,
      );
    }

    this.jurisdictionConfigurations.push({ ...configuration });
  }

  addMappingSet(mappingSet: TaxMappingSet): void {
    this.validatePeriod(mappingSet.effectiveFrom, mappingSet.effectiveTo);
    if (!mappingSet.version?.trim()) {
      throw new BadRequestException('Tax mapping version is required');
    }

    if (
      this.mappingSets.some(
        existing => existing.version === mappingSet.version,
      )
    ) {
      throw new BadRequestException(
        `Mapping version ${mappingSet.version} is already registered`,
      );
    }
    if (
      this.mappingSets.some(existing =>
        this.periodsOverlap(existing, mappingSet),
      )
    ) {
      throw new BadRequestException('Tax mapping-set effective periods overlap');
    }

    this.mappingSets.push({
      ...mappingSet,
      classifications: { ...mappingSet.classifications },
    });
  }

  getJurisdictionConfiguration(
    jurisdiction: TaxJurisdiction,
    effectiveFrom: string,
    effectiveTo: string,
  ): TaxJurisdictionConfiguration {
    const configuration = this.jurisdictionConfigurations.find(
      candidate =>
        candidate.jurisdiction === jurisdiction &&
        this.coversPeriod(candidate, effectiveFrom, effectiveTo),
    );
    if (!configuration) {
      throw new BadRequestException(
        `No ${jurisdiction} configuration covers the reporting period`,
      );
    }
    return { ...configuration };
  }

  getMappingSet(effectiveFrom: string, effectiveTo: string): TaxMappingSet {
    const mappingSet = this.mappingSets.find(candidate =>
      this.coversPeriod(candidate, effectiveFrom, effectiveTo),
    );
    if (!mappingSet) {
      throw new BadRequestException(
        'No tax mapping set covers the reporting period',
      );
    }
    return { ...mappingSet, classifications: { ...mappingSet.classifications } };
  }

  private coversPeriod(
    candidate: { effectiveFrom: string; effectiveTo: string },
    periodFrom: string,
    periodTo: string,
  ): boolean {
    return (
      candidate.effectiveFrom <= periodFrom &&
      candidate.effectiveTo >= periodTo
    );
  }

  private periodsOverlap(
    first: { effectiveFrom: string; effectiveTo: string },
    second: { effectiveFrom: string; effectiveTo: string },
  ): boolean {
    const firstEnd = Date.parse(`${first.effectiveTo}T00:00:00.000Z`);
    const secondEnd = Date.parse(`${second.effectiveTo}T00:00:00.000Z`);
    return (
      Date.parse(`${first.effectiveFrom}T00:00:00.000Z`) < secondEnd &&
      Date.parse(`${second.effectiveFrom}T00:00:00.000Z`) < firstEnd
    );
  }

  private validatePeriod(from: string, to: string): void {
    if (!this.isDateOnly(from) || !this.isDateOnly(to)) {
      throw new BadRequestException('Effective dates must use YYYY-MM-DD format');
    }
    if (from >= to) {
      throw new BadRequestException(
        'effectiveTo must be later than effectiveFrom (exclusive)',
      );
    }
  }

  private isDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }
}
