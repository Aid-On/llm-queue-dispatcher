# @aid-on/llm-queue-dispatcher

> 🧠 LLM Queue Dispatcher for LLM requests with advanced scoring algorithms and rate-limit awareness

[![npm version](https://badge.fury.io/js/%40aid-on%2Fllm-queue-dispatcher.svg)](https://www.npmjs.com/package/@aid-on/llm-queue-dispatcher)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Overview

`@aid-on/llm-queue-dispatcher` is a sophisticated queueing system designed specifically for LLM (Large Language Model) request processing. It uses advanced scoring algorithms to intelligently select the most optimal requests for processing based on multiple factors including priority, token efficiency, wait time, and rate limiting constraints.

🚀 **[Try the Interactive Demo](https://aid-on-libs.github.io/llm-queue-dispatcher/)** - Experience the queue in action with real-time visualizations!

## Features

- 🎯 **Multi-dimensional Scoring**: Considers priority, efficiency, wait time, retry count, token fit, and processing time
- ⚡ **Rate Limiter Integration**: Seamlessly works with `@aid-on/llm-throttle` for rate-aware processing
- 🔄 **Prefetching Support**: Optional message prefetching for improved throughput
- 🗂️ **Abstract Storage**: Pluggable storage adapters (in-memory included, extend for SQS, Redis, etc.)
- 📊 **Rich Metrics**: Comprehensive monitoring and performance metrics
- 🏭 **Factory Functions**: Pre-configured queue types for common use cases
- 🧪 **TypeScript First**: Fully typed with excellent IDE support

## Installation

```bash
npm install @aid-on/llm-queue-dispatcher
```

## Quick Start

### Basic Usage

```typescript
import { createInMemoryLLMQueueDispatcher, Priority } from '@aid-on/llm-queue-dispatcher';
import { createLLMThrottle } from '@aid-on/llm-throttle';

// Create queue and rate limiter
const queue = createInMemoryLLMQueueDispatcher();
const rateLimiter = createLLMThrottle({ rpm: 60, tpm: 10000 });

// Enqueue requests
await queue.enqueue({
  id: 'req-1',
  payload: { prompt: 'Hello, world!' },
  priority: Priority.HIGH,
  tokenInfo: { estimated: 150 },
  createdAt: new Date()
});

// Process messages
const processable = await queue.dequeue(rateLimiter);
if (processable) {
  try {
    // Your LLM processing logic here
    const result = await processLLMRequest(processable.message.payload);
    await processable.markAsProcessed();
  } catch (error) {
    await processable.markAsFailed(error);
  }
}
```

### Custom Storage

```typescript
import { createLLMQueueDispatcher } from '@aid-on/llm-queue-dispatcher';

// Implement your storage adapter
class SQSStorage implements QueueStorageAdapter {
  async enqueue(message) { /* SQS implementation */ }
  async dequeue(limit, timeout) { /* SQS implementation */ }
  // ... other methods
}

const queue = createLLMQueueDispatcher(new SQSStorage(), {
  enablePrefetch: true,
  bufferSize: 100
});
```

## API Reference

### Core Classes

#### `LLMQueueDispatcher<T>`

The main queue class that handles intelligent message selection and processing.

```typescript
class LLMQueueDispatcher<T = LLMPayload> {
  constructor(storage: QueueStorageAdapter<LLMRequest<T>>, config?: LLMQueueDispatcherConfig)
  
  async enqueue(request: LLMRequest<T>): Promise<void>
  async batchEnqueue(requests: LLMRequest<T>[]): Promise<void>
  async dequeue(rateLimiter: LLMThrottle): Promise<ProcessableMessage<T> | null>
  async getQueueMetrics(): Promise<QueueMetrics>
  async purge(): Promise<void>
  stop(): void
}
```

#### Configuration

```typescript
interface LLMQueueDispatcherConfig {
  bufferSize?: number;                    // Prefetch buffer size (default: 50)
  enablePrefetch?: boolean;               // Enable message prefetching (default: false)
  prefetchInterval?: number;              // Prefetch interval in ms (default: 5000)
  maxCandidatesToEvaluate?: number;       // Max messages to score (default: 20)
  minScoreThreshold?: number;             // Minimum score to process (default: 0.1)
  scoring?: ScoringConfig;                // Custom scoring configuration
  metricsRetentionMs?: number;            // Metrics retention time
  logger?: Logger;                        // Custom logger
}
```

### Factory Functions

#### `createInMemoryQueue<T>(config?)`
Creates a queue with in-memory storage (ideal for testing and development).

#### `createPrefetchingQueue<T>(storage, config?)`
Creates a queue with prefetching enabled for high-throughput scenarios.

#### `createSimplePriorityQueue<T>(storage, config?)`
Creates a queue that primarily uses priority-based selection.

#### `createThroughputOptimizedQueue<T>(storage, config?)`
Creates a queue optimized for maximum throughput and TPM efficiency.

#### `createFairQueue<T>(storage, config?)`
Creates a queue that balances fairness with priority (FIFO-like behavior).

### Message Types

```typescript
interface LLMRequest<T = LLMPayload> {
  id: string;
  payload: T;
  priority: Priority;
  tokenInfo: TokenInfo;
  expectedProcessingTime?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

enum Priority {
  URGENT = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3
}
```

## Advanced Usage

### Custom Scoring

```typescript
const queue = createLLMQueueDispatcher(storage, {
  scoring: {
    weights: {
      priority: 0.3,
      efficiency: 0.25,
      waitTime: 0.25,
      retry: 0.1,
      tokenFit: 0.1,
      processingTime: 0.0
    },
    customScorers: [{
      name: 'deadline',
      weight: 0.2,
      calculate: (message, context) => {
        const deadline = message.payload.metadata?.deadline as number;
        if (!deadline) return 0.5;
        const timeLeft = deadline - context.currentTime;
        return Math.max(0, Math.min(1, timeLeft / 3600000)); // 1 hour max
      }
    }]
  }
});
```

### Storage Adapter Implementation

```typescript
class RedisStorage implements QueueStorageAdapter<LLMRequest> {
  constructor(private redis: Redis) {}
  
  async enqueue(message: LLMRequest): Promise<QueueMessage<LLMRequest>> {
    const queueMessage = {
      id: generateId(),
      payload: message,
      attributes: {
        messageId: generateId(),
        receiptHandle: generateHandle(),
        enqueuedAt: new Date(),
        receiveCount: 0
      }
    };
    
    await this.redis.lpush('queue', JSON.stringify(queueMessage));
    return queueMessage;
  }
  
  async dequeue(limit: number, visibilityTimeout: number): Promise<QueueMessage<LLMRequest>[]> {
    // Redis implementation with visibility timeout logic
    // ...
  }
  
  // Implement other required methods...
}
```

### Monitoring and Metrics

```typescript
const metrics = await queue.getQueueMetrics();

console.log(`Total messages: ${metrics.queue.totalMessages}`);
console.log(`In-flight: ${metrics.processing.activeRequests}`);
console.log(`Throughput: ${metrics.queue.throughput.messagesPerMinute} msg/min`);
console.log(`Buffer utilization: ${metrics.performance.bufferUtilization * 100}%`);
```

## Integration with LLM Throttle

The queue is designed to work seamlessly with `@aid-on/llm-throttle`:

```typescript
import { createLLMThrottle } from '@aid-on/llm-throttle';

const rateLimiter = createLLMThrottle({
  rpm: 60,        // 60 requests per minute
  tpm: 10000,     // 10,000 tokens per minute
  burstTPM: 15000 // Allow bursts up to 15,000 TPM
});

// The queue automatically considers rate limits when selecting messages
const processable = await queue.dequeue(rateLimiter);
```

## Error Handling

```typescript
const processable = await queue.dequeue(rateLimiter);
if (processable) {
  try {
    const result = await processLLMRequest(processable.message.payload);
    await processable.markAsProcessed();
  } catch (error) {
    if (error.code === 'RATE_LIMITED') {
      // Extend visibility timeout to retry later
      await processable.updateVisibility(300); // 5 minutes
    } else {
      // Mark as failed for other errors
      await processable.markAsFailed(error);
    }
  }
}
```

## Demo

Explore the interactive demo to see the intelligent queue in action:

```bash
# Clone the repository
git clone https://github.com/aid-on-libs/llm-queue-dispatcher.git
cd llm-queue-dispatcher

# Install dependencies
npm install

# Start the demo server
npm run demo:dev
```

The demo features:
- **Real-time Queue Visualization**: See messages moving through pending, processing, and completed states
- **Interactive Rate Limiting**: Adjust RPM/TPM limits and see their effect on message selection
- **Scoring Algorithm Demonstration**: View detailed scoring breakdowns for each message
- **Multiple Queue Types**: Compare different pre-configured queue strategies
- **Live Metrics Dashboard**: Monitor throughput, efficiency, and performance metrics

## Testing

The library includes comprehensive test utilities:

```typescript
import { createInMemoryLLMQueueDispatcher } from '@aid-on/llm-queue-dispatcher';

// In-memory queue is perfect for testing
const testQueue = createInMemoryQueue();

// Test your queue processing logic
await testQueue.enqueue(mockRequest);
const processable = await testQueue.dequeue(mockRateLimiter);
expect(processable).toBeDefined();
```

## Performance Tips

1. **Enable Prefetching**: For high-throughput scenarios, enable prefetching to reduce dequeue latency
2. **Tune Buffer Size**: Larger buffers provide more selection options but use more memory
3. **Optimize Scoring**: Adjust scoring weights based on your specific requirements
4. **Monitor Metrics**: Use the built-in metrics to identify bottlenecks
5. **Custom Storage**: Implement storage adapters optimized for your infrastructure

## License

MIT © aid-on

## Contributing

Contributions are welcome! Please check our [GitHub repository](https://github.com/aid-on-libs/llm-queue-dispatcher) for issues and contribution guidelines.

---

For more examples and detailed documentation, visit our [GitHub Pages site](https://aid-on-libs.github.io/llm-queue-dispatcher/).