import type { RateLimitMetrics } from '@aid-on/llm-throttle';

export enum Priority {
  URGENT = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3
}

export interface TokenInfo {
  estimated: number;
  actual?: number;
  model?: string;
}

export interface LLMPayload {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface LLMRequest<T = LLMPayload> {
  id: string;
  payload: T;
  priority: Priority;
  tokenInfo: TokenInfo;
  expectedProcessingTime?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface QueueMessage<T = LLMRequest> {
  id: string;
  payload: T;
  attributes: {
    messageId: string;
    receiptHandle: string;
    enqueuedAt: Date;
    receiveCount: number;
    firstReceivedAt?: Date;
  };
}

export interface ProcessableMessage<T = LLMPayload> {
  message: QueueMessage<LLMRequest<T>>;
  markAsProcessed: () => Promise<void>;
  markAsFailed: (error: Error) => Promise<void>;
  updateVisibility: (seconds: number) => Promise<void>;
}

export interface InFlightMessage<T = LLMPayload> {
  message: QueueMessage<LLMRequest<T>>;
  startedAt: number;
  rateLimiter: any; // DualRateLimiter
}

export interface MessageScore {
  total: number;
  breakdown: {
    priority: number;
    efficiency: number;
    waitTime: number;
    retry: number;
    tokenFit: number;
    processingTime: number;
  };
}

export interface ScoredMessage<T = LLMPayload> {
  message: QueueMessage<LLMRequest<T>>;
  score: MessageScore;
  breakdown: MessageScore['breakdown'];
  waitTimeUntilReady: number;
}

export interface MessageSelection<T = LLMPayload> {
  message: QueueMessage<LLMRequest<T>>;
  score: MessageScore;
  reason: string;
}

export interface ScoringWeights {
  priority: number;
  efficiency: number;
  waitTime: number;
  retry: number;
  tokenFit: number;
  processingTime: number;
}

export interface ScoringConfig {
  weights?: ScoringWeights;
  customScorers?: Array<CustomScorer>;
}

export interface CustomScorer {
  name: string;
  weight: number;
  calculate: (message: QueueMessage<any>, context: ScoringContext) => number;
}

export interface ScoringContext {
  rateLimiterMetrics: RateLimitMetrics;
  queueMetrics: QueueMetricsReport;
  currentTime: number;
}

export interface QueueMetricsReport {
  totalMessages: number;
  messagesByPriority: Record<Priority, number>;
  oldestMessageAge: number;
  averageWaitTime: number;
  throughput: {
    messagesPerMinute: number;
    tokensPerMinute: number;
  };
}

export interface LLMQueueDispatcherConfig {
  bufferSize?: number;
  enablePrefetch?: boolean;
  prefetchInterval?: number;
  maxCandidatesToEvaluate?: number;
  minScoreThreshold?: number;
  scoring?: ScoringConfig;
  metricsRetentionMs?: number;
  logger?: Logger;
}

export interface Logger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export interface MetricsCollector {
  recordEnqueue: (message: QueueMessage<any>) => void;
  recordDequeue: (message: QueueMessage<any>) => void;
  recordComplete: (message: QueueMessage<any>, processingTimeMs: number) => void;
  recordFailure: (message: QueueMessage<any>, error: Error) => void;
  getReport: () => QueueMetricsReport;
  cleanup: () => void;
}