import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LLMQueueDispatcher } from '../llm-queue-dispatcher.js';
import { InMemoryStorage } from '../storage/in-memory.js';
import { Priority } from '../types/index.js';
import type { LLMRequest, LLMQueueDispatcherConfig } from '../types/index.js';

// Mock LLMThrottle
const mockLLMThrottle = {
  canProcess: vi.fn(),
  getMetrics: vi.fn()
};

describe('LLMQueueDispatcher', () => {
  let storage: InMemoryStorage<LLMRequest>;
  let queue: LLMQueueDispatcher;
  let config: LLMQueueDispatcherConfig;

  const createRequest = (
    id: string, 
    priority: Priority = Priority.NORMAL,
    tokens: number = 100
  ): LLMRequest => ({
    id,
    payload: { prompt: `Test prompt ${id}` },
    priority,
    tokenInfo: { estimated: tokens },
    createdAt: new Date()
  });

  beforeEach(() => {
    storage = new InMemoryStorage<LLMRequest>();
    config = {
      bufferSize: 10,
      enablePrefetch: false,
      maxCandidatesToEvaluate: 5,
      minScoreThreshold: 0.1,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    };
    queue = new LLMQueueDispatcher(storage, config);

    // Setup default mock responses
    mockLLMThrottle.canProcess.mockReturnValue({
      allowed: true,
      availableTokens: { rpm: 10, tpm: 1000 }
    });
    mockLLMThrottle.getMetrics.mockReturnValue({
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
    });
  });

  afterEach(() => {
    queue.stop();
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('should enqueue messages successfully', async () => {
      const request = createRequest('test-1', Priority.HIGH);
      await queue.enqueue(request);

      const count = await storage.getApproximateMessageCount();
      expect(count).toBe(1);
    });

    it('should handle batch enqueue', async () => {
      const requests = [
        createRequest('batch-1', Priority.HIGH),
        createRequest('batch-2', Priority.NORMAL),
        createRequest('batch-3', Priority.LOW)
      ];

      await queue.batchEnqueue(requests);

      const count = await storage.getApproximateMessageCount();
      expect(count).toBe(3);
    });
  });

  describe('dequeue', () => {
    it('should dequeue messages when rate limiter allows', async () => {
      const request = createRequest('test-1', Priority.HIGH);
      await queue.enqueue(request);

      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeDefined();
      expect(processable?.message.payload.id).toBe('test-1');
    });

    it('should return null when no messages available', async () => {
      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeNull();
    });

    it('should return null when rate limiter blocks all messages', async () => {
      mockLLMThrottle.canProcess.mockReturnValue({
        allowed: false,
        reason: 'tpm_limit',
        availableIn: 5000,
        availableTokens: { rpm: 10, tpm: 50 }
      });

      const request = createRequest('test-1', Priority.HIGH, 100);
      await queue.enqueue(request);

      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeNull();
    });

    it('should prioritize urgent messages', async () => {
      await queue.enqueue(createRequest('low', Priority.LOW));
      await queue.enqueue(createRequest('urgent', Priority.URGENT));
      await queue.enqueue(createRequest('normal', Priority.NORMAL));

      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable?.message.payload.id).toBe('urgent');
    });

    it('should consider token efficiency in selection', async () => {
      // Mock available TPM as 1000
      mockLLMThrottle.getMetrics.mockReturnValue({
        ...mockLLMThrottle.getMetrics(),
        tpm: { used: 1000, available: 1000, limit: 2000, percentage: 50 }
      });

      // Add messages with different token requirements
      await queue.enqueue(createRequest('small', Priority.NORMAL, 50));    // Too small
      await queue.enqueue(createRequest('perfect', Priority.NORMAL, 800));  // Good fit
      await queue.enqueue(createRequest('large', Priority.NORMAL, 1200));   // Too large

      // Block the large message
      mockLLMThrottle.canProcess.mockImplementation((tokens: number) => {
        if (tokens > 1000) {
          return { allowed: false, reason: 'tpm_limit', availableTokens: { rpm: 10, tpm: 1000 } };
        }
        return { allowed: true, availableTokens: { rpm: 10, tpm: 1000 } };
      });

      const processable = await queue.dequeue(mockLLMThrottle as any);
      // Should prefer the well-fitting message over the small one
      expect(processable?.message.payload.id).toBe('perfect');
    });
  });

  describe('message processing', () => {
    it('should handle successful message processing', async () => {
      const request = createRequest('test-1');
      await queue.enqueue(request);

      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeDefined();

      await processable!.markAsProcessed();

      // Message should be removed from storage
      const count = await storage.getApproximateMessageCount();
      expect(count).toBe(0);
    });

    it('should handle failed message processing', async () => {
      const request = createRequest('test-1');
      await queue.enqueue(request);

      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeDefined();

      const error = new Error('Processing failed');
      await processable!.markAsFailed(error);

      expect(config.logger?.error).toHaveBeenCalledWith(
        expect.stringContaining('failed: Processing failed')
      );
    });

    it('should allow visibility timeout updates', async () => {
      const request = createRequest('test-1');
      await queue.enqueue(request);

      const processable = await queue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeDefined();

      // Should not throw
      await expect(processable!.updateVisibility(60)).resolves.not.toThrow();
    });
  });

  describe('metrics and monitoring', () => {
    it('should provide queue metrics', async () => {
      await queue.enqueue(createRequest('test-1', Priority.HIGH));
      await queue.enqueue(createRequest('test-2', Priority.NORMAL));

      const metrics = await queue.getQueueMetrics();

      expect(metrics.queue.totalMessages).toBeGreaterThan(0);
      expect(metrics.processing.activeRequests).toBeDefined();
      expect(metrics.performance.prefetchEnabled).toBe(false);
    });

    it('should track in-flight messages', async () => {
      const request = createRequest('test-1');
      await queue.enqueue(request);

      await queue.dequeue(mockLLMThrottle as any);

      const metrics = await queue.getQueueMetrics();
      expect(metrics.processing.activeRequests).toBe(1);
      expect(metrics.processing.inFlightDetails).toHaveLength(1);
    });
  });

  describe('queue management', () => {
    it('should support purging all messages', async () => {
      await queue.enqueue(createRequest('test-1'));
      await queue.enqueue(createRequest('test-2'));
      await queue.dequeue(mockLLMThrottle as any); // Make one in-flight

      await queue.purge();

      const count = await storage.getApproximateMessageCount();
      expect(count).toBe(0);

      const metrics = await queue.getQueueMetrics();
      expect(metrics.processing.activeRequests).toBe(0);
    });

    it('should stop prefetch workers when stopped', () => {
      const queueWithPrefetch = new LLMQueueDispatcher(storage, {
        ...config,
        enablePrefetch: true,
        prefetchInterval: 100
      });

      // Should not throw
      expect(() => queueWithPrefetch.stop()).not.toThrow();
    });
  });

  describe('scoring and selection', () => {
    it('should respect minimum score threshold', async () => {
      const highThresholdQueue = new LLMQueueDispatcher(storage, {
        ...config,
        minScoreThreshold: 0.9 // Very high threshold
      });

      await highThresholdQueue.enqueue(createRequest('test-1', Priority.LOW));

      const processable = await highThresholdQueue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeNull(); // Should be rejected due to low score

      highThresholdQueue.stop();
    });

    it('should handle custom scoring weights', async () => {
      const priorityFocusedQueue = new LLMQueueDispatcher(storage, {
        ...config,
        scoring: {
          weights: {
            priority: 0.9,
            efficiency: 0.02,
            waitTime: 0.02,
            retry: 0.02,
            tokenFit: 0.02,
            processingTime: 0.02
          }
        }
      });

      await priorityFocusedQueue.enqueue(createRequest('low', Priority.LOW, 800));    // Good efficiency
      await priorityFocusedQueue.enqueue(createRequest('urgent', Priority.URGENT, 50)); // Poor efficiency

      const processable = await priorityFocusedQueue.dequeue(mockLLMThrottle as any);
      // Should prefer urgent despite poor efficiency due to priority weight
      expect(processable?.message.payload.id).toBe('urgent');

      priorityFocusedQueue.stop();
    });

    it('should consider wait time in scoring', async () => {
      // Enqueue an old message
      await queue.enqueue(createRequest('old', Priority.NORMAL));
      
      // Wait a bit, then enqueue a new message with higher priority
      await new Promise(resolve => setTimeout(resolve, 100));
      await queue.enqueue(createRequest('new-high', Priority.HIGH));

      const processable = await queue.dequeue(mockLLMThrottle as any);
      // Should prefer high priority despite shorter wait time
      expect(processable?.message.payload.id).toBe('new-high');
    });
  });

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      const errorStorage = {
        ...storage,
        dequeue: vi.fn().mockRejectedValue(new Error('Storage error'))
      };

      const errorQueue = new LLMQueueDispatcher(errorStorage as any, config);

      // Should not throw, but return null
      const processable = await errorQueue.dequeue(mockLLMThrottle as any);
      expect(processable).toBeNull();

      errorQueue.stop();
    });

    it('should handle rate limiter errors', async () => {
      const errorRateLimiter = {
        ...mockLLMThrottle,
        canProcess: vi.fn().mockImplementation(() => {
          throw new Error('Rate limiter error');
        })
      };

      await queue.enqueue(createRequest('test-1'));

      // Should handle error and return null
      const processable = await queue.dequeue(errorRateLimiter as any);
      expect(processable).toBeNull();
    });
  });
});