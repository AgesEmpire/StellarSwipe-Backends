import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { QueryAnalyzerService, SLOW_QUERY_QUEUE } from './query-analyzer.service';
import { AnalyzerController } from './analyzer.controller';
import { SlowQuery } from './entities/slow-query.entity';
import { QueryOptimization } from './entities/query-optimization.entity';
import { ExplainAnalyzer } from './analyzers/explain-analyzer';
import { IndexAnalyzer } from './analyzers/index-analyzer';
import { JoinAnalyzer } from './analyzers/join-analyzer';
import { AnalyzeSlowQueriesJob } from './jobs/analyze-slow-queries.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([SlowQuery, QueryOptimization]),
    BullModule.registerQueue({ name: SLOW_QUERY_QUEUE }),
  ],
  controllers: [AnalyzerController],
  providers: [
    QueryAnalyzerService,
    ExplainAnalyzer,
    IndexAnalyzer,
    JoinAnalyzer,
    AnalyzeSlowQueriesJob,
  ],
  exports: [QueryAnalyzerService],
})
export class QueryAnalyzerModule {}
