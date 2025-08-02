import type { QueueMessage, LLMRequest, LLMPayload } from '../types/index.js';

/**
 * Abstract storage adapter interface for queue persistence
 */
export interface QueueStorageAdapter<T = LLMRequest<LLMPayload>> {
  /**
   * Enqueue a message to the storage
   */
  enqueue(message: T): Promise<QueueMessage<T>>;
  
  /**
   * Dequeue messages from storage (visibility timeout mechanism)
   */
  dequeue(limit: number, visibilityTimeoutSeconds: number): Promise<QueueMessage<T>[]>;
  
  /**
   * Delete a message from storage
   */
  deleteMessage(receiptHandle: string): Promise<void>;
  
  /**
   * Update visibility timeout for a message
   */
  updateVisibilityTimeout(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>;
  
  /**
   * Get approximate number of messages
   */
  getApproximateMessageCount(): Promise<number>;
  
  /**
   * Get messages by priority without dequeuing
   */
  peekMessagesByPriority(priority: number, limit: number): Promise<QueueMessage<T>[]>;
  
  /**
   * Batch enqueue multiple messages
   */
  batchEnqueue?(messages: T[]): Promise<QueueMessage<T>[]>;
  
  /**
   * Batch delete multiple messages
   */
  batchDelete?(receiptHandles: string[]): Promise<void>;
  
  /**
   * Get queue attributes/metrics
   */
  getQueueAttributes?(): Promise<QueueAttributes>;
  
  /**
   * Purge all messages
   */
  purge?(): Promise<void>;
}

export interface QueueAttributes {
  approximateNumberOfMessages: number;
  approximateNumberOfMessagesInFlight: number;
  createdTimestamp?: number;
  lastModifiedTimestamp?: number;
  queueArn?: string;
  visibilityTimeout?: number;
  maximumMessageSize?: number;
  messageRetentionPeriod?: number;
}

/**
 * In-memory storage implementation for testing and development
 */
export interface InMemoryQueueStorage<T = LLMRequest<LLMPayload>> extends QueueStorageAdapter<T> {
  /**
   * Get all messages (for testing)
   */
  getAllMessages(): QueueMessage<T>[];
  
  /**
   * Get in-flight messages (for testing)
   */
  getInFlightMessages(): Map<string, QueueMessage<T>>;
}