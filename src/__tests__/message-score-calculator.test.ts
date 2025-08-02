import { describe, it, expect, beforeEach } from 'vitest';
import { MessageScoreCalculator } from '../utils/message-score-calculator.js';
import { Priority } from '../types/index.js';
import type { QueueMessage, LLMRequest, ScoringContext } from '../types/index.js';

describe('MessageScoreCalculator', () => {
  let calculator: MessageScoreCalculator;
  let mockContext: ScoringContext;

  const createMessage = (
    id: string, 
    priority: Priority, 
    tokens: number,
    enqueuedAt: Date = new Date(Date.now() - 30000),
    receiveCount: number = 0
  ): QueueMessage<LLMRequest> => ({
    id,
    payload: {
      id,
      payload: { prompt: 'test' },
      priority,
      tokenInfo: { estimated: tokens },
      createdAt: new Date()
    },
    attributes: {
      messageId: id,
      receiptHandle: `receipt-${id}`,
      enqueuedAt,
      receiveCount
    }
  });

  beforeEach(() => {
    calculator = new MessageScoreCalculator();
    mockContext = {
      rateLimiterMetrics: {
        rpm: { used: 5, available: 15, limit: 20, percentage: 25 },
        tpm: { used: 500, available: 1500, limit: 2000, percentage: 25 },
        efficiency: 0.85,
        consumptionHistory: {
          count: 10,
          averageTokensPerRequest: 100,
          totalTokens: 1000,
          estimationAccuracy: 0.9
        },
        memory: {
          historyRecords: 10,
          estimatedMemoryUsage: 2000,
          maxHistoryRecords: 1000
        },
        compensation: {
          totalDebt: 0,
          pendingCompensation: 0
        }
      },
      queueMetrics: {
        totalMessages: 100,
        messagesByPriority: {
          [Priority.URGENT]: 5,
          [Priority.HIGH]: 20,
          [Priority.NORMAL]: 60,
          [Priority.LOW]: 15
        },
        oldestMessageAge: 120000,
        averageWaitTime: 45000,
        throughput: {
          messagesPerMinute: 10,
          tokensPerMinute: 1000
        }
      },
      currentTime: Date.now()
    };
  });

  describe('calculateScore', () => {
    it('should calculate higher scores for urgent priority', () => {
      const urgentMsg = createMessage('urgent', Priority.URGENT, 100);
      const normalMsg = createMessage('normal', Priority.NORMAL, 100);

      const urgentScore = calculator.calculateScore(urgentMsg, mockContext);
      const normalScore = calculator.calculateScore(normalMsg, mockContext);

      expect(urgentScore.total).toBeGreaterThan(normalScore.total);
      expect(urgentScore.breakdown.priority).toBeGreaterThan(normalScore.breakdown.priority);
    });

    it('should calculate higher scores for better efficiency', () => {
      // Message that uses 80% of available TPM (efficient)
      const efficientMsg = createMessage('efficient', Priority.NORMAL, 1200);
      // Message that uses 10% of available TPM (less efficient)
      const inefficientMsg = createMessage('inefficient', Priority.NORMAL, 150);

      const efficientScore = calculator.calculateScore(efficientMsg, mockContext);
      const inefficientScore = calculator.calculateScore(inefficientMsg, mockContext);

      expect(efficientScore.breakdown.efficiency).toBeGreaterThan(inefficientScore.breakdown.efficiency);
    });

    it('should increase score for longer wait times', () => {
      const oldMsg = createMessage('old', Priority.NORMAL, 100, new Date(Date.now() - 60000));
      const newMsg = createMessage('new', Priority.NORMAL, 100, new Date(Date.now() - 5000));

      const oldScore = calculator.calculateScore(oldMsg, mockContext);
      const newScore = calculator.calculateScore(newMsg, mockContext);

      expect(oldScore.breakdown.waitTime).toBeGreaterThan(newScore.breakdown.waitTime);
    });

    it('should penalize messages with high retry count', () => {
      const freshMsg = createMessage('fresh', Priority.NORMAL, 100, new Date(), 0);
      const retriedMsg = createMessage('retried', Priority.NORMAL, 100, new Date(), 3);

      const freshScore = calculator.calculateScore(freshMsg, mockContext);
      const retriedScore = calculator.calculateScore(retriedMsg, mockContext);

      expect(freshScore.breakdown.retry).toBeGreaterThan(retriedScore.breakdown.retry);
    });

    it('should handle custom weights', () => {
      const customCalculator = new MessageScoreCalculator({
        weights: {
          priority: 0.9,
          efficiency: 0.05,
          waitTime: 0.05,
          retry: 0,
          tokenFit: 0,
          processingTime: 0
        }
      });

      const msg = createMessage('test', Priority.HIGH, 100);
      const score = customCalculator.calculateScore(msg, mockContext);

      // Priority should dominate the score
      expect(score.breakdown.priority).toBeGreaterThan(score.breakdown.efficiency);
      expect(score.breakdown.priority).toBeGreaterThan(score.breakdown.waitTime);
    });

    it('should handle messages that dont fit in available TPM', () => {
      // Message requiring more tokens than available
      const oversizedMsg = createMessage('oversized', Priority.NORMAL, 2000);
      const score = calculator.calculateScore(oversizedMsg, mockContext);

      expect(score.breakdown.tokenFit).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle zero available TPM', () => {
      const zeroTPMContext = {
        ...mockContext,
        rateLimiterMetrics: {
          ...mockContext.rateLimiterMetrics,
          tpm: { used: 2000, available: 0, limit: 2000, percentage: 100 }
        }
      };

      const msg = createMessage('test', Priority.NORMAL, 100);
      const score = calculator.calculateScore(msg, zeroTPMContext);

      expect(score.breakdown.efficiency).toBe(0);
      expect(score.breakdown.tokenFit).toBe(0);
    });

    it('should handle urgent messages with long wait times', () => {
      const urgentOldMsg = createMessage(
        'urgent-old',
        Priority.URGENT,
        100,
        new Date(Date.now() - 30000) // 30 seconds old
      );

      const score = calculator.calculateScore(urgentOldMsg, mockContext);

      // Should have high priority and wait time scores
      expect(score.breakdown.priority).toBeGreaterThan(0.15); // URGENT priority * weight (1.0 * 0.25)
      expect(score.breakdown.waitTime).toBeGreaterThan(0.1);
    });

    it('should handle messages with expected processing time', () => {
      const fastMsg = createMessage('fast', Priority.NORMAL, 100);
      fastMsg.payload.expectedProcessingTime = 500; // 500ms

      const slowMsg = createMessage('slow', Priority.NORMAL, 100);
      slowMsg.payload.expectedProcessingTime = 10000; // 10s

      const fastScore = calculator.calculateScore(fastMsg, mockContext);
      const slowScore = calculator.calculateScore(slowMsg, mockContext);

      expect(fastScore.breakdown.processingTime).toBeGreaterThan(slowScore.breakdown.processingTime);
    });
  });

  describe('scoring weights validation', () => {
    it('should use default weights when none provided', () => {
      const msg = createMessage('test', Priority.NORMAL, 100);
      const score = calculator.calculateScore(msg, mockContext);

      // All breakdown components should be > 0 for a normal message
      expect(score.breakdown.priority).toBeGreaterThan(0);
      expect(score.breakdown.efficiency).toBeGreaterThan(0);
      expect(score.breakdown.waitTime).toBeGreaterThan(0);
      expect(score.breakdown.retry).toBeGreaterThan(0);
      expect(score.breakdown.tokenFit).toBeGreaterThan(0);
      expect(score.breakdown.processingTime).toBeGreaterThan(0);
    });

    it('should normalize scores to reasonable ranges', () => {
      const msg = createMessage('test', Priority.NORMAL, 100);
      const score = calculator.calculateScore(msg, mockContext);

      // Total score should be reasonable (components are weighted)
      expect(score.total).toBeGreaterThan(0);
      expect(score.total).toBeLessThan(2); // With default weights, max should be around 1

      // Individual scores should be in 0-1 range before weighting
      Object.values(score.breakdown).forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });
  });
});