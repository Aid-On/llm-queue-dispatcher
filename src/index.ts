// Main exports
export { LLMQueueDispatcher } from './llm-queue-dispatcher.js';
export { InMemoryStorage } from './storage/in-memory.js';
export { PriorityBuffer } from './utils/priority-buffer.js';
export { MetricsCollector } from './utils/metrics-collector.js';
export { MessageScoreCalculator } from './utils/message-score-calculator.js';


// Type exports
export type {
  // Core types
  TokenInfo,
  LLMPayload,
  LLMRequest,
  QueueMessage,
  ProcessableMessage,
  InFlightMessage,
  
  // Scoring types
  MessageScore,
  ScoredMessage,
  MessageSelection,
  ScoringWeights,
  ScoringConfig,
  CustomScorer,
  ScoringContext,
  
  // Configuration types
  LLMQueueDispatcherConfig,
  Logger,
  
  // Metrics types
  QueueMetricsReport,
  MetricsCollector as IMetricsCollector
} from './types/index.js';

export type {
  QueueStorageAdapter,
  QueueAttributes,
  InMemoryQueueStorage
} from './storage/types.js';

// Re-export Priority enum for convenience
export { Priority } from './types/index.js';


// Factory functions
import type { LLMPayload, LLMRequest, LLMQueueDispatcherConfig } from './types/index.js';
import type { QueueStorageAdapter } from './storage/types.js';
import { LLMQueueDispatcher } from './llm-queue-dispatcher.js';
import { InMemoryStorage } from './storage/in-memory.js';

/**
 * Create an LLMQueueDispatcher with custom storage
 */
export function createLLMQueueDispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: LLMQueueDispatcherConfig
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, config);
}

/**
 * Create an LLMQueueDispatcher with custom storage (snake_case)
 */
export function create_llm_queue_dispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: LLMQueueDispatcherConfig
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, config);
}


/**
 * Create an LLMQueueDispatcher with in-memory storage (for testing/development)
 */
export function createInMemoryLLMQueueDispatcher<T = LLMPayload>(
  config?: LLMQueueDispatcherConfig
): LLMQueueDispatcher<T> {
  const storage = new InMemoryStorage<LLMRequest<T>>();
  return new LLMQueueDispatcher<T>(storage, config);
}

/**
 * Create an LLMQueueDispatcher with in-memory storage (snake_case)
 */
export function create_in_memory_llm_queue_dispatcher<T = LLMPayload>(
  config?: LLMQueueDispatcherConfig
): LLMQueueDispatcher<T> {
  const storage = new InMemoryStorage<LLMRequest<T>>();
  return new LLMQueueDispatcher<T>(storage, config);
}


/**
 * Create an LLMQueueDispatcher with prefetching enabled
 */
export function createPrefetchingLLMQueueDispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'enablePrefetch'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    enablePrefetch: true,
    bufferSize: config?.bufferSize || 100,
    prefetchInterval: config?.prefetchInterval || 5000
  });
}

/**
 * Create an LLMQueueDispatcher with prefetching enabled (snake_case)
 */
export function create_prefetching_llm_queue_dispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'enablePrefetch'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    enablePrefetch: true,
    bufferSize: config?.bufferSize || 100,
    prefetchInterval: config?.prefetchInterval || 5000
  });
}


/**
 * Create a simple priority LLMQueueDispatcher without advanced scoring
 */
export function createSimplePriorityLLMQueueDispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'scoring'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    scoring: {
      weights: {
        priority: 0.8,      // Heavily weight priority
        efficiency: 0.05,
        waitTime: 0.1,
        retry: 0.05,
        tokenFit: 0,
        processingTime: 0
      }
    }
  });
}

/**
 * Create a simple priority LLMQueueDispatcher without advanced scoring (snake_case)
 */
export function create_simple_priority_llm_queue_dispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'scoring'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    scoring: {
      weights: {
        priority: 0.8,      // Heavily weight priority
        efficiency: 0.05,
        waitTime: 0.1,
        retry: 0.05,
        tokenFit: 0,
        processingTime: 0
      }
    }
  });
}


/**
 * Create an LLMQueueDispatcher optimized for throughput
 */
export function createThroughputOptimizedLLMQueueDispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'scoring'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    enablePrefetch: true,
    bufferSize: 200,
    maxCandidatesToEvaluate: 50,
    scoring: {
      weights: {
        priority: 0.15,
        efficiency: 0.35,   // Maximize TPM usage
        waitTime: 0.1,
        retry: 0.05,
        tokenFit: 0.25,     // Prefer messages that fit well
        processingTime: 0.1
      }
    }
  });
}

/**
 * Create an LLMQueueDispatcher optimized for throughput (snake_case)
 */
export function create_throughput_optimized_llm_queue_dispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'scoring'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    enablePrefetch: true,
    bufferSize: 200,
    maxCandidatesToEvaluate: 50,
    scoring: {
      weights: {
        priority: 0.15,
        efficiency: 0.35,   // Maximize TPM usage
        waitTime: 0.1,
        retry: 0.05,
        tokenFit: 0.25,     // Prefer messages that fit well
        processingTime: 0.1
      }
    }
  });
}


/**
 * Create an LLMQueueDispatcher optimized for fairness (FIFO-like with priority consideration)
 */
export function createFairLLMQueueDispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'scoring'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    scoring: {
      weights: {
        priority: 0.2,
        efficiency: 0.1,
        waitTime: 0.5,      // Heavily weight wait time
        retry: 0.15,        // Give failed messages another chance
        tokenFit: 0.05,
        processingTime: 0
      }
    }
  });
}

/**
 * Create an LLMQueueDispatcher optimized for fairness (snake_case)
 */
export function create_fair_llm_queue_dispatcher<T = LLMPayload>(
  storage: QueueStorageAdapter<LLMRequest<T>>,
  config?: Omit<LLMQueueDispatcherConfig, 'scoring'>
): LLMQueueDispatcher<T> {
  return new LLMQueueDispatcher<T>(storage, {
    ...config,
    scoring: {
      weights: {
        priority: 0.2,
        efficiency: 0.1,
        waitTime: 0.5,      // Heavily weight wait time
        retry: 0.15,        // Give failed messages another chance
        tokenFit: 0.05,
        processingTime: 0
      }
    }
  });
}


