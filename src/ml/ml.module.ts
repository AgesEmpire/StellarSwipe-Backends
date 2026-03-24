import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { Signal } from '../signals/entities/signal.entity';
import { ProviderStats } from '../signals/entities/provider-stats.entity';
import { PriceOracleModule } from '../prices/price-oracle.module';
import { AnalyticsModule } from '../analytics/analytics.module';
// Legacy forecasting
import { FeatureEngineeringService } from './forecasting/feature-engineering.service';
import { ModelTrainingService } from './forecasting/model-training.service';
import { SignalForecastingService } from './forecasting/signal-forecasting.service';
import { SignalPredictorModel } from './models/signal-predictor.model';
import { SignalForecastingController } from './forecasting/signal-forecasting.controller';
// Signal prediction (ML ensemble)
import { Prediction } from './signal-prediction/entities/prediction.entity';
import { TrainingData } from './signal-prediction/entities/training-data.entity';
import { ModelVersion } from './signal-prediction/entities/model-version.entity';
import { FeatureExtractorService } from './signal-prediction/feature-extractor.service';
import { ModelTrainerService } from './signal-prediction/model-trainer.service';
import { SignalPredictorService } from './signal-prediction/signal-predictor.service';
import { RetrainModelsJob } from './signal-prediction/jobs/retrain-models.job';
import { ValidatePredictionsJob } from './signal-prediction/jobs/validate-predictions.job';
import { UpdateFeaturesJob } from './signal-prediction/jobs/update-features.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Signal,
      ProviderStats,
      Prediction,
      TrainingData,
      ModelVersion,
    ]),
    CacheModule.register(),
    PriceOracleModule,
    AnalyticsModule,
  ],
  controllers: [SignalForecastingController],
  providers: [
    // Legacy forecasting
    FeatureEngineeringService,
    ModelTrainingService,
    SignalForecastingService,
    SignalPredictorModel,
    // Signal prediction (ML ensemble)
    FeatureExtractorService,
    ModelTrainerService,
    SignalPredictorService,
    RetrainModelsJob,
    ValidatePredictionsJob,
    UpdateFeaturesJob,
  ],
  exports: [SignalForecastingService, SignalPredictorService, ModelTrainerService],
})
export class MlModule {}
