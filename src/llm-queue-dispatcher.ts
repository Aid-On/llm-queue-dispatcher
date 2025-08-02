import type { LLMThrottle } from '@aid-on/llm-throttle';
import type {
  QueueMessage,
  LLMRequest,
  LLMPayload,
  ProcessableMessage,
  InFlightMessage,
  MessageSelection,
  ScoredMessage,
  LLMQueueDispatcherConfig,
  Logger,
  ScoringContext
} from './types/index.js';
import { Priority } from './types/index.js';
import type { QueueStorageAdapter } from './storage/types.js';
import { PriorityBuffer } from './utils/priority-buffer.js';
import { MetricsCollector } from './utils/metrics-collector.js';
import { MessageScoreCalculator } from './utils/message-score-calculator.js';

export class LLMQueueDispatcher<T = LLMPayload> {
  private inFlightMessages: Map<string, InFlightMessage<T>>;
  private prefetchBuffer: PriorityBuffer<LLMRequest<T>>;
  private metrics: MetricsCollector;
  private scoreCalculator: MessageScoreCalculator;
  private logger: Logger;
  private prefetchInterval?: NodeJS.Timeout;
  private visibilityTimeout: number = 30;

  constructor(
    private storage: QueueStorageAdapter<LLMRequest<T>>,
    private config: LLMQueueDispatcherConfig = {}
  ) {
    this.inFlightMessages = new Map();
    this.prefetchBuffer = new PriorityBuffer(config.bufferSize || 50);
    this.metrics = new MetricsCollector(config.metricsRetentionMs);
    this.scoreCalculator = new MessageScoreCalculator(config.scoring || {});
    this.logger = config.logger || console;
    
    if (config.enablePrefetch) {
      this.startPrefetchWorker();
    }
  }

  async enqueue(request: LLMRequest<T>): Promise<void> {
    const message = await this.storage.enqueue(request);
    this.metrics.recordEnqueue(message);
    this.logger.debug(`Enqueued message ${message.id} with priority ${Priority[request.priority]}`);
  }

  async batchEnqueue(requests: LLMRequest<T>[]): Promise<void> {
    if (this.storage.batchEnqueue) {
      const messages = await this.storage.batchEnqueue(requests);
      messages.forEach(msg => this.metrics.recordEnqueue(msg));
      this.logger.debug(`Batch enqueued ${messages.length} messages`);
    } else {
      for (const request of requests) {
        await this.enqueue(request);
      }
    }
  }

  async dequeue(rateLimiter: LLMThrottle): Promise<ProcessableMessage<T> | null> {
    try {
      // Prefetch more messages if buffer is low
      if (this.prefetchBuffer.size() < 10 && !this.config.enablePrefetch) {
        await this.prefetchMessages();
      }

      const candidates = this.getCandidatesFromBuffer();
      
      if (candidates.length === 0 && !this.config.enablePrefetch) {
        return await this.fetchAndProcessDirectly(rateLimiter);
      }
      
      const selection = this.selectOptimalMessage(candidates, rateLimiter);
      if (!selection) return null;
      
      this.prefetchBuffer.remove(selection.message);
      return this.prepareForProcessing(selection.message, rateLimiter);
    } catch (error) {
      this.logger.error(`Dequeue error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private selectOptimalMessage(
    candidates: QueueMessage<LLMRequest<T>>[],
    rateLimiter: LLMThrottle
  ): MessageSelection<T> | null {
    const metrics = rateLimiter.getMetrics();
    const now = Date.now();
    const context: ScoringContext = {
      rateLimiterMetrics: metrics,
      queueMetrics: this.metrics.getReport(),
      currentTime: now
    };
    
    const scoredCandidates = candidates
      .map(message => {
        const request = message.payload;
        const canProcess = rateLimiter.canProcess(request.tokenInfo.estimated);
        
        if (!canProcess.allowed) {
          return null;
        }
        
        const score = this.scoreCalculator.calculateScore(message, context);
        
        return {
          message,
          score,
          breakdown: score.breakdown,
          waitTimeUntilReady: canProcess.availableIn || 0
        };
      })
      .filter((item): item is ScoredMessage<T> => item !== null);
    
    if (scoredCandidates.length === 0) return null;
    
    const selected = scoredCandidates.reduce((best, current) => 
      current.score.total > best.score.total ? current : best
    );
    
    if (selected.score.total < (this.config.minScoreThreshold || 0.1)) {
      return null;
    }
    
    return {
      message: selected.message,
      score: selected.score,
      reason: this.explainSelection(selected)
    };
  }

  private explainSelection(selected: ScoredMessage<T>): string {
    const breakdown = selected.score.breakdown;
    const topFactors = Object.entries(breakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([factor]) => factor);
    
    const request = selected.message.payload;
    const explanations = {
      priority: `High priority (${Priority[request.priority]})`,
      efficiency: `Efficient TPM usage (${request.tokenInfo.estimated} tokens)`,
      waitTime: `Long wait time (${Math.round((Date.now() - selected.message.attributes.enqueuedAt.getTime()) / 1000)}s)`,
      retry: `Low retry count (${selected.message.attributes.receiveCount})`,
      tokenFit: `Good token fit for available capacity`,
      processingTime: `Quick processing time expected`
    };
    
    return `Selected due to: ${topFactors.map(f => explanations[f as keyof typeof explanations]).join(' and ')}`;
  }

  private getCandidatesFromBuffer(): QueueMessage<LLMRequest<T>>[] {
    const maxCandidates = this.config.maxCandidatesToEvaluate || 20;
    return this.prefetchBuffer.peekByPriority(maxCandidates);
  }

  private async prepareForProcessing(
    message: QueueMessage<LLMRequest<T>>,
    rateLimiter: LLMThrottle
  ): Promise<ProcessableMessage<T>> {
    const inFlightEntry: InFlightMessage<T> = {
      message,
      startedAt: Date.now(),
      rateLimiter
    };
    
    this.inFlightMessages.set(message.id, inFlightEntry);
    this.metrics.recordDequeue(message);
    
    return {
      message,
      markAsProcessed: async () => {
        await this.storage.deleteMessage(message.attributes.receiptHandle);
        this.inFlightMessages.delete(message.id);
        const processingTime = Date.now() - inFlightEntry.startedAt;
        this.metrics.recordComplete(message, processingTime);
        this.logger.debug(`Message ${message.id} processed successfully in ${processingTime}ms`);
      },
      markAsFailed: async (error: Error) => {
        this.inFlightMessages.delete(message.id);
        this.metrics.recordFailure(message, error);
        this.logger.error(`Message ${message.id} failed: ${error.message}`);
        // Message will become visible again after visibility timeout
      },
      updateVisibility: async (seconds: number) => {
        await this.storage.updateVisibilityTimeout(
          message.attributes.receiptHandle,
          seconds
        );
      }
    };
  }

  private async fetchAndProcessDirectly(rateLimiter: LLMThrottle): Promise<ProcessableMessage<T> | null> {
    try {
      const messages = await this.storage.dequeue(10, this.visibilityTimeout);
      if (messages.length === 0) return null;
      
      // Score and select from fetched messages
      const selection = this.selectOptimalMessage(messages, rateLimiter);
      if (!selection) {
        // Return messages to queue by letting visibility timeout expire
        return null;
      }
      
      return this.prepareForProcessing(selection.message, rateLimiter);
    } catch (error) {
      this.logger.error(`Storage fetch error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async prefetchMessages(): Promise<void> {
    try {
      const needed = this.config.bufferSize || 50 - this.prefetchBuffer.size();
      if (needed <= 0) return;
      
      const messages = await this.storage.dequeue(needed, this.visibilityTimeout);
      
      for (const message of messages) {
        const priority = message.payload.priority;
        this.prefetchBuffer.add(message, priority);
      }
      
      if (messages.length > 0) {
        this.logger.debug(`Prefetched ${messages.length} messages into buffer`);
      }
    } catch (error) {
      this.logger.error(`Prefetch error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private startPrefetchWorker(): void {
    const interval = this.config.prefetchInterval || 5000;
    
    this.prefetchInterval = setInterval(async () => {
      await this.prefetchMessages();
      
      // Update visibility for messages in buffer to prevent timeout
      const bufferedMessages = this.prefetchBuffer.getAll();
      for (const message of bufferedMessages) {
        try {
          await this.storage.updateVisibilityTimeout(
            message.attributes.receiptHandle,
            this.visibilityTimeout
          );
        } catch (error) {
          this.logger.warn(`Failed to update visibility for message ${message.id}`);
          this.prefetchBuffer.remove(message);
        }
      }
    }, interval);
  }

  async getQueueMetrics(): Promise<{
    queue: any;
    processing: any;
    performance: any;
  }> {
    const queueAttrs = this.storage.getQueueAttributes 
      ? await this.storage.getQueueAttributes()
      : { approximateNumberOfMessages: 0, approximateNumberOfMessagesInFlight: 0 };
    
    const metricsReport = this.metrics.getReport();
    
    return {
      queue: {
        approximateNumberOfMessages: queueAttrs.approximateNumberOfMessages,
        approximateNumberOfMessagesInFlight: queueAttrs.approximateNumberOfMessagesInFlight,
        bufferedMessages: this.prefetchBuffer.size(),
        ...metricsReport
      },
      processing: {
        activeRequests: this.inFlightMessages.size,
        inFlightDetails: Array.from(this.inFlightMessages.values()).map(entry => ({
          messageId: entry.message.id,
          priority: Priority[entry.message.payload.priority],
          startedAt: new Date(entry.startedAt),
          processingTimeMs: Date.now() - entry.startedAt
        }))
      },
      performance: {
        prefetchEnabled: this.config.enablePrefetch || false,
        bufferUtilization: this.prefetchBuffer.size() / (this.config.bufferSize || 50)
      }
    };
  }

  stop(): void {
    if (this.prefetchInterval) {
      clearInterval(this.prefetchInterval);
      this.prefetchInterval = undefined;
    }
  }

  async purge(): Promise<void> {
    this.stop();
    this.inFlightMessages.clear();
    this.prefetchBuffer.clear();
    if (this.storage.purge) {
      await this.storage.purge();
    }
    this.logger.info('Queue purged');
  }
}