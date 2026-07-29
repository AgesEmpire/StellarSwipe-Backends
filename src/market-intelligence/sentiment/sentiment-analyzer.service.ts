import { Injectable } from '@nestjs/common';

export interface SentimentScore {
  asset: string;
  score: number; // -1 to 1 scale
  confidence: number; // 0 to 1 scale
  sources: string[];
  timestamp: Date;
}

export interface MarketSentiment {
  overall: number;
  assets: Record<string, SentimentScore>;
  trending: string[];
}

@Injectable()
export class SentimentAnalyzerService {
  
  async analyzeSentiment(text: string): Promise<{ score: number; confidence: number }> {
    // Simple keyword-based sentiment analysis
    const positiveWords = ['bullish', 'moon', 'pump', 'buy', 'long', 'up', 'rise', 'gain'];
    const negativeWords = ['bearish', 'dump', 'sell', 'short', 'down', 'fall', 'crash', 'loss'];
    
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    let matches = 0;
    
    words.forEach(word => {
      if (positiveWords.includes(word)) {
        score += 1;
        matches++;
      } else if (negativeWords.includes(word)) {
        score -= 1;
        matches++;
      }
    });
    
    const normalizedScore = matches > 0 ? Math.max(-1, Math.min(1, score / matches)) : 0;
    const confidence = Math.min(1, matches / 10);
    
    return { score: normalizedScore, confidence };
  }

  async getMarketSentiment(assets: string[]): Promise<MarketSentiment> {
    const assetSentiments: Record<string, SentimentScore> = {};
    let totalScore = 0;
    
    for (const asset of assets) {
      const sentiment = await this.getAssetSentiment(asset);
      assetSentiments[asset] = sentiment;
      totalScore += sentiment.score;
    }
    
    const overall = assets.length > 0 ? totalScore / assets.length : 0;
    const trending = assets
      .sort((a, b) => assetSentiments[b].score - assetSentiments[a].score)
      .slice(0, 5);
    
    return { overall, assets: assetSentiments, trending };
  }

  private async getAssetSentiment(asset: string): Promise<SentimentScore> {
    // Mock sentiment data - in production, aggregate from social and news services
    const mockScore = (Math.random() - 0.5) * 2; // -1 to 1
    const mockConfidence = Math.random() * 0.8 + 0.2; // 0.2 to 1
    
    return {
      asset,
      score: mockScore,
      confidence: mockConfidence,
      sources: ['social', 'news'],
      timestamp: new Date()
    };
  }
}