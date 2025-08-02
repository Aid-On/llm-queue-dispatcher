import type {
  QueueMessage,
  LLMRequest,
  MessageScore,
  ScoringWeights,
  ScoringConfig,
  CustomScorer,
  ScoringContext
} from '../types/index.js';
import { Priority } from '../types/index.js';

export class MessageScoreCalculator {
  private weights: ScoringWeights;
  private customScorers: CustomScorer[];

  constructor(config: ScoringConfig = {}) {
    this.weights = config.weights || this.getDefaultWeights();
    this.customScorers = config.customScorers || [];
  }

  calculateScore(
    message: QueueMessage<LLMRequest<any>>,
    context: ScoringContext
  ): MessageScore {
    const request = message.payload;
    const now = context.currentTime;
    const rateLimiterMetrics = context.rateLimiterMetrics;

    // Base scores
    const priorityScore = this.calculatePriorityScore(request.priority);
    const efficiencyScore = this.calculateEfficiencyScore(
      request.tokenInfo.estimated,
      rateLimiterMetrics.tpm.available,
      rateLimiterMetrics.tpm.limit
    );
    const waitTimeScore = this.calculateWaitTimeScore(
      now - message.attributes.enqueuedAt.getTime(),
      request.priority
    );
    const retryPenalty = this.calculateRetryPenalty(
      message.attributes.receiveCount
    );
    const tokenFitScore = this.calculateTokenFitScore(
      request.tokenInfo.estimated,
      rateLimiterMetrics.tpm.available
    );
    const processingTimeScore = this.calculateProcessingTimeScore(
      request.tokenInfo.estimated,
      request.expectedProcessingTime
    );

    // Apply weights
    const breakdown = {
      priority: priorityScore * this.weights.priority,
      efficiency: efficiencyScore * this.weights.efficiency,
      waitTime: waitTimeScore * this.weights.waitTime,
      retry: retryPenalty * this.weights.retry,
      tokenFit: tokenFitScore * this.weights.tokenFit,
      processingTime: processingTimeScore * this.weights.processingTime
    };

    // Add custom scores
    let customTotal = 0;
    for (const scorer of this.customScorers) {
      const score = scorer.calculate(message, context) * scorer.weight;
      customTotal += score;
    }

    const total = Object.values(breakdown).reduce((sum, score) => sum + score, 0) + customTotal;

    return { total, breakdown };
  }

  private calculatePriorityScore(priority: Priority): number {
    const priorityMap = {
      [Priority.URGENT]: 1.0,
      [Priority.HIGH]: 0.7,
      [Priority.NORMAL]: 0.4,
      [Priority.LOW]: 0.1
    };
    return priorityMap[priority];
  }

  private calculateEfficiencyScore(
    estimatedTokens: number,
    availableTPM: number,
    _tpmLimit: number
  ): number {
    if (availableTPM <= 0) return 0;

    const utilization = estimatedTokens / availableTPM;

    if (utilization >= 0.7 && utilization <= 0.9) {
      return 1.0;
    } else if (utilization > 0.9 && utilization <= 1.0) {
      return 0.9;
    } else if (utilization > 1.0) {
      return 0;
    } else {
      return utilization / 0.7;
    }
  }

  private calculateWaitTimeScore(
    waitTimeMs: number,
    priority: Priority
  ): number {
    const maxWaitTimes = {
      [Priority.URGENT]: 10 * 1000,
      [Priority.HIGH]: 30 * 1000,
      [Priority.NORMAL]: 60 * 1000,
      [Priority.LOW]: 300 * 1000
    };

    const maxWait = maxWaitTimes[priority];
    const score = Math.min(waitTimeMs / maxWait, 1.0);

    if (priority === Priority.URGENT) {
      return Math.pow(score, 0.5);
    }

    return score;
  }

  private calculateRetryPenalty(receiveCount: number): number {
    if (receiveCount === 0) return 1.0;
    return Math.max(0.1, Math.pow(0.7, receiveCount));
  }

  private calculateTokenFitScore(
    estimatedTokens: number,
    availableTPM: number
  ): number {
    if (availableTPM <= 0) return 0;

    const ratio = estimatedTokens / availableTPM;

    if (ratio < 0.1) {
      return ratio * 10;
    } else if (ratio >= 0.1 && ratio <= 0.5) {
      return 1.0;
    } else if (ratio > 0.5 && ratio <= 1.0) {
      return 1.0 - ((ratio - 0.5) * 0.4);
    } else {
      return 0;
    }
  }

  private calculateProcessingTimeScore(
    estimatedTokens: number,
    expectedProcessingTimeMs?: number
  ): number {
    if (!expectedProcessingTimeMs) {
      const estimatedTime = estimatedTokens * 10;
      return this.normalizeProcessingTime(estimatedTime);
    }

    return this.normalizeProcessingTime(expectedProcessingTimeMs);
  }

  private normalizeProcessingTime(timeMs: number): number {
    if (timeMs <= 1000) return 1.0;
    if (timeMs <= 5000) return 1.0 - ((timeMs - 1000) / 4000 * 0.3);
    if (timeMs <= 30000) return 0.7 - ((timeMs - 5000) / 25000 * 0.6);
    return 0.1;
  }

  private getDefaultWeights(): ScoringWeights {
    return {
      priority: 0.25,
      efficiency: 0.20,
      waitTime: 0.20,
      retry: 0.10,
      tokenFit: 0.15,
      processingTime: 0.10
    };
  }
}