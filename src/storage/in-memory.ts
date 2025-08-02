import type { 
  InMemoryQueueStorage as IInMemoryQueueStorage,
  QueueAttributes 
} from './types.js';
import type { QueueMessage, LLMRequest, LLMPayload } from '../types/index.js';

interface InMemoryMessage<T> {
  message: QueueMessage<T>;
  visibilityTimeout?: number;
  deleteAt?: number;
}

export class InMemoryStorage<T = LLMRequest<LLMPayload>> 
  implements IInMemoryQueueStorage<T> {
  
  private messages: Map<string, InMemoryMessage<T>> = new Map();
  private inFlight: Map<string, QueueMessage<T>> = new Map();
  private messageCounter = 0;
  private createdAt = Date.now();
  private lastModified = Date.now();

  async enqueue(message: T): Promise<QueueMessage<T>> {
    const messageId = `msg-${++this.messageCounter}`;
    const receiptHandle = `receipt-${messageId}-${Date.now()}`;
    
    const queueMessage: QueueMessage<T> = {
      id: messageId,
      payload: message,
      attributes: {
        messageId,
        receiptHandle,
        enqueuedAt: new Date(),
        receiveCount: 0
      }
    };
    
    this.messages.set(messageId, { message: queueMessage });
    this.lastModified = Date.now();
    
    return queueMessage;
  }

  async dequeue(
    limit: number, 
    visibilityTimeoutSeconds: number
  ): Promise<QueueMessage<T>[]> {
    const now = Date.now();
    const results: QueueMessage<T>[] = [];
    
    // Clean up expired in-flight messages
    for (const [receiptHandle, message] of this.inFlight.entries()) {
      const inMemMsg = this.messages.get(message.id);
      if (inMemMsg && inMemMsg.visibilityTimeout && inMemMsg.visibilityTimeout < now) {
        this.inFlight.delete(receiptHandle);
        inMemMsg.visibilityTimeout = undefined;
      }
    }
    
    // Find available messages
    for (const [id, inMemMsg] of this.messages.entries()) {
      if (results.length >= limit) break;
      
      // Skip if already in flight
      if (inMemMsg.visibilityTimeout && inMemMsg.visibilityTimeout > now) {
        continue;
      }
      
      // Skip if scheduled for deletion
      if (inMemMsg.deleteAt && inMemMsg.deleteAt <= now) {
        this.messages.delete(id);
        continue;
      }
      
      // Update message
      const newReceiptHandle = `receipt-${id}-${Date.now()}`;
      inMemMsg.message.attributes.receiptHandle = newReceiptHandle;
      inMemMsg.message.attributes.receiveCount++;
      if (!inMemMsg.message.attributes.firstReceivedAt) {
        inMemMsg.message.attributes.firstReceivedAt = new Date();
      }
      
      inMemMsg.visibilityTimeout = now + (visibilityTimeoutSeconds * 1000);
      
      this.inFlight.set(newReceiptHandle, inMemMsg.message);
      results.push({ ...inMemMsg.message });
    }
    
    return results;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    const message = this.inFlight.get(receiptHandle);
    if (!message) {
      throw new Error(`Message with receipt handle ${receiptHandle} not found`);
    }
    
    this.messages.delete(message.id);
    this.inFlight.delete(receiptHandle);
    this.lastModified = Date.now();
  }

  async updateVisibilityTimeout(
    receiptHandle: string, 
    visibilityTimeoutSeconds: number
  ): Promise<void> {
    const message = this.inFlight.get(receiptHandle);
    if (!message) {
      throw new Error(`Message with receipt handle ${receiptHandle} not found`);
    }
    
    const inMemMsg = this.messages.get(message.id);
    if (inMemMsg) {
      inMemMsg.visibilityTimeout = Date.now() + (visibilityTimeoutSeconds * 1000);
    }
  }

  async getApproximateMessageCount(): Promise<number> {
    const now = Date.now();
    let count = 0;
    
    for (const [, inMemMsg] of this.messages.entries()) {
      if (!inMemMsg.visibilityTimeout || inMemMsg.visibilityTimeout < now) {
        count++;
      }
    }
    
    return count;
  }

  async peekMessagesByPriority(
    priority: number, 
    limit: number
  ): Promise<QueueMessage<T>[]> {
    const results: QueueMessage<T>[] = [];
    const now = Date.now();
    
    for (const [, inMemMsg] of this.messages.entries()) {
      if (results.length >= limit) break;
      
      // Skip if in flight
      if (inMemMsg.visibilityTimeout && inMemMsg.visibilityTimeout > now) {
        continue;
      }
      
      // Check priority (assuming T has a priority field)
      const payload = inMemMsg.message.payload as any;
      if (payload.priority === priority) {
        results.push({ ...inMemMsg.message });
      }
    }
    
    return results;
  }

  async batchEnqueue(messages: T[]): Promise<QueueMessage<T>[]> {
    const results: QueueMessage<T>[] = [];
    for (const message of messages) {
      results.push(await this.enqueue(message));
    }
    return results;
  }

  async batchDelete(receiptHandles: string[]): Promise<void> {
    for (const handle of receiptHandles) {
      await this.deleteMessage(handle);
    }
  }

  async getQueueAttributes(): Promise<QueueAttributes> {
    const now = Date.now();
    let inFlightCount = 0;
    
    for (const [, inMemMsg] of this.messages.entries()) {
      if (inMemMsg.visibilityTimeout && inMemMsg.visibilityTimeout > now) {
        inFlightCount++;
      }
    }
    
    return {
      approximateNumberOfMessages: this.messages.size - inFlightCount,
      approximateNumberOfMessagesInFlight: inFlightCount,
      createdTimestamp: this.createdAt,
      lastModifiedTimestamp: this.lastModified,
      visibilityTimeout: 30,
      maximumMessageSize: 256 * 1024,
      messageRetentionPeriod: 4 * 24 * 60 * 60
    };
  }

  async purge(): Promise<void> {
    this.messages.clear();
    this.inFlight.clear();
    this.lastModified = Date.now();
  }

  // Testing methods
  getAllMessages(): QueueMessage<T>[] {
    return Array.from(this.messages.values()).map(m => m.message);
  }

  getInFlightMessages(): Map<string, QueueMessage<T>> {
    return new Map(this.inFlight);
  }
}