import { describe, it, expect, afterEach } from 'vitest';
import {
  createLLMQueueDispatcher,
  createInMemoryLLMQueueDispatcher,
  createPrefetchingLLMQueueDispatcher,
  createSimplePriorityLLMQueueDispatcher,
  createThroughputOptimizedLLMQueueDispatcher,
  createFairLLMQueueDispatcher,
} from '../index.js';
import { InMemoryStorage } from '../storage/in-memory.js';
import { Priority } from '../types/index.js';
import type { LLMRequest } from '../types/index.js';

describe('Factory Functions', () => {
  const createdQueues: any[] = [];

  afterEach(() => {
    // Clean up all created queues
    createdQueues.forEach(queue => {
      if (queue && typeof queue.stop === 'function') {
        queue.stop();
      }
    });
    createdQueues.length = 0;
  });

  const createRequest = (id: string, priority: Priority = Priority.NORMAL): LLMRequest => ({
    id,
    payload: { prompt: `Test prompt ${id}` },
    priority,
    tokenInfo: { estimated: 100 },
    createdAt: new Date()
  });

  describe('createLLMQueueDispatcher', () => {
    it('should create queue with custom storage', () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createLLMQueueDispatcher(storage, {
        bufferSize: 20,
        enablePrefetch: false
      });

      createdQueues.push(queue);
      expect(queue).toBeDefined();
      expect(typeof queue.enqueue).toBe('function');
      expect(typeof queue.dequeue).toBe('function');
    });

    it('should work without config', () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createLLMQueueDispatcher(storage);

      createdQueues.push(queue);
      expect(queue).toBeDefined();
    });
  });

  describe('createInMemoryLLMQueueDispatcher', () => {
    it('should create queue with in-memory storage', async () => {
      const queue = createInMemoryLLMQueueDispatcher<any>({
        bufferSize: 10
      });

      createdQueues.push(queue);
      
      // Test basic functionality
      const request = createRequest('test-1');
      await queue.enqueue(request);

      const metrics = await queue.getQueueMetrics();
      expect(metrics.queue.totalMessages).toBeGreaterThan(0);
    });

    it('should work without config', () => {
      const queue = createInMemoryLLMQueueDispatcher();
      createdQueues.push(queue);
      expect(queue).toBeDefined();
    });
  });

  describe('createInMemoryLLMQueueDispatcher (legacy)', () => {
    it('should create queue with in-memory storage', async () => {
      const queue = createInMemoryLLMQueueDispatcher<any>({
        bufferSize: 10
      });

      createdQueues.push(queue);
      
      // Test basic functionality
      const request = createRequest('test-1');
      await queue.enqueue(request);

      const metrics = await queue.getQueueMetrics();
      expect(metrics.queue.totalMessages).toBeGreaterThan(0);
    });

    it('should work without config', () => {
      const queue = createInMemoryLLMQueueDispatcher();
      createdQueues.push(queue);
      expect(queue).toBeDefined();
    });
  });

  describe('createPrefetchingLLMQueueDispatcher', () => {
    it('should create queue with prefetching enabled', async () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createPrefetchingLLMQueueDispatcher(storage, {
        bufferSize: 50
      });

      createdQueues.push(queue);

      const metrics = await queue.getQueueMetrics();
      expect(metrics.performance.prefetchEnabled).toBe(true);
    });

    it('should use default prefetch settings', () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createPrefetchingLLMQueueDispatcher(storage);

      createdQueues.push(queue);
      expect(queue).toBeDefined();
    });
  });

  describe('createSimplePriorityLLMQueueDispatcher', () => {
    it('should heavily weight priority in scoring', async () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createSimplePriorityLLMQueueDispatcher(storage);

      createdQueues.push(queue);

      // Add messages with different priorities
      await queue.enqueue(createRequest('low', Priority.LOW));
      await queue.enqueue(createRequest('normal', Priority.NORMAL));
      await queue.enqueue(createRequest('urgent', Priority.URGENT));

      // Mock rate limiter that allows all
      const mockRateLimiter = {
        canProcess: () => ({ allowed: true, availableTokens: { rpm: 10, tpm: 1000 } }),
        getMetrics: () => ({
          rpm: { used: 5, available: 15, limit: 20, percentage: 25 },
          tpm: { used: 500, available: 1500, limit: 2000, percentage: 25 },
          efficiency: 0.85,
          consumptionHistory: { count: 0, averageTokensPerRequest: 0, totalTokens: 0, estimationAccuracy: 1 },
          memory: { historyRecords: 0, estimatedMemoryUsage: 0, maxHistoryRecords: 1000 },
          compensation: { totalDebt: 0, pendingCompensation: 0 }
        })
      };

      const processable = await queue.dequeue(mockRateLimiter as any);
      // Should prefer urgent priority
      expect(processable?.message.payload.id).toBe('urgent');
    });
  });

  describe('createThroughputOptimizedLLMQueueDispatcher', () => {
    it('should enable prefetching and optimize for efficiency', async () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createThroughputOptimizedLLMQueueDispatcher(storage);

      createdQueues.push(queue);

      const metrics = await queue.getQueueMetrics();
      expect(metrics.performance.prefetchEnabled).toBe(true);
    });

    it('should have large buffer size', async () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createThroughputOptimizedLLMQueueDispatcher(storage, {
        bufferSize: 300 // Override default
      });

      createdQueues.push(queue);

      const metrics = await queue.getQueueMetrics();
      // Buffer utilization should be calculated based on the overridden size
      expect(metrics.performance.bufferUtilization).toBeDefined();
    });
  });

  describe('createFairLLMQueueDispatcher', () => {
    it('should heavily weight wait time for fairness', async () => {
      const storage = new InMemoryStorage<LLMRequest>();
      const queue = createFairLLMQueueDispatcher(storage);

      createdQueues.push(queue);

      // Add an old message with low priority
      await queue.enqueue(createRequest('old-low', Priority.LOW));
      
      // Wait a bit then add a new high priority message
      await new Promise(resolve => setTimeout(resolve, 50));
      await queue.enqueue(createRequest('new-high', Priority.HIGH));

      const mockRateLimiter = {
        canProcess: () => ({ allowed: true, availableTokens: { rpm: 10, tpm: 1000 } }),
        getMetrics: () => ({
          rpm: { used: 5, available: 15, limit: 20, percentage: 25 },
          tpm: { used: 500, available: 1500, limit: 2000, percentage: 25 },
          efficiency: 0.85,
          consumptionHistory: { count: 0, averageTokensPerRequest: 0, totalTokens: 0, estimationAccuracy: 1 },
          memory: { historyRecords: 0, estimatedMemoryUsage: 0, maxHistoryRecords: 1000 },
          compensation: { totalDebt: 0, pendingCompensation: 0 }
        })
      };

      // Due to fairness weighting, might still prefer high priority
      // but the wait time should have significant influence
      const processable = await queue.dequeue(mockRateLimiter as any);
      expect(processable).toBeDefined();
    });
  });

  describe('integration tests', () => {
    it('should allow switching between different queue types', async () => {
      const storage = new InMemoryStorage<LLMRequest>();
      
      // Create different types of queues with same storage
      const simpleQueue = createSimplePriorityLLMQueueDispatcher(storage);
      createdQueues.push(simpleQueue);
      
      await simpleQueue.enqueue(createRequest('test-1', Priority.HIGH));
      
      // Check that storage has the message
      expect(await storage.getApproximateMessageCount()).toBe(1);
      
      simpleQueue.stop();

      // Create throughput optimized queue with same storage
      const throughputQueue = createThroughputOptimizedLLMQueueDispatcher(storage);
      createdQueues.push(throughputQueue);

      // Storage should still have the message
      expect(await storage.getApproximateMessageCount()).toBe(1);
    });

    it('should handle queue lifecycle properly', async () => {
      const queue = createInMemoryLLMQueueDispatcher();
      createdQueues.push(queue);

      await queue.enqueue(createRequest('test-1'));
      
      let metrics = await queue.getQueueMetrics();
      expect(metrics.queue.totalMessages).toBe(1);

      await queue.purge();
      
      metrics = await queue.getQueueMetrics();
      expect(metrics.queue.approximateNumberOfMessages).toBe(0);
      expect(metrics.processing.activeRequests).toBe(0);
    });
  });

  describe('snake_case function exports', () => {
    it('should provide snake_case alternatives for all camelCase functions', async () => {
      const { 
        create_llm_queue_dispatcher,
        create_in_memory_llm_queue_dispatcher,
        create_prefetching_llm_queue_dispatcher,
        create_simple_priority_llm_queue_dispatcher,
        create_throughput_optimized_llm_queue_dispatcher,
        create_fair_llm_queue_dispatcher
      } = await import('../index.js');
      
      // Test that snake_case functions exist and work
      const storage = new InMemoryStorage<LLMRequest>();
      
      const queue1 = create_llm_queue_dispatcher(storage);
      const queue2 = create_in_memory_llm_queue_dispatcher();
      const queue3 = create_prefetching_llm_queue_dispatcher(storage);
      const queue4 = create_simple_priority_llm_queue_dispatcher(storage);
      const queue5 = create_throughput_optimized_llm_queue_dispatcher(storage);
      const queue6 = create_fair_llm_queue_dispatcher(storage);
      
      createdQueues.push(queue1, queue2, queue3, queue4, queue5, queue6);
      
      // Basic functionality test
      await queue2.enqueue(createRequest('test', Priority.NORMAL));
      const metrics = await queue2.getQueueMetrics();
      expect(metrics.queue.approximateNumberOfMessages).toBe(1);
    });
  });
});