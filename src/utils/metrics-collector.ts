import type { 
  QueueMessage, 
  MetricsCollector as IMetricsCollector,
  QueueMetricsReport
} from '../types/index.js';
import { Priority } from '../types/index.js';

interface MetricRecord {
  timestamp: number;
  type: 'enqueue' | 'dequeue' | 'complete' | 'failure';
  messageId: string;
  priority?: Priority;
  processingTimeMs?: number;
  errorMessage?: string;
}

export class MetricsCollector implements IMetricsCollector {
  private records: MetricRecord[] = [];
  private retentionMs: number;
  private maxRecords: number;

  constructor(retentionMs: number = 300000, maxRecords: number = 10000) {
    this.retentionMs = retentionMs;
    this.maxRecords = maxRecords;
  }

  recordEnqueue(message: QueueMessage<any>): void {
    this.addRecord({
      timestamp: Date.now(),
      type: 'enqueue',
      messageId: message.id,
      priority: message.payload.priority
    });
  }

  recordDequeue(message: QueueMessage<any>): void {
    this.addRecord({
      timestamp: Date.now(),
      type: 'dequeue',
      messageId: message.id,
      priority: message.payload.priority
    });
  }

  recordComplete(message: QueueMessage<any>, processingTimeMs: number): void {
    this.addRecord({
      timestamp: Date.now(),
      type: 'complete',
      messageId: message.id,
      priority: message.payload.priority,
      processingTimeMs
    });
  }

  recordFailure(message: QueueMessage<any>, error: Error): void {
    this.addRecord({
      timestamp: Date.now(),
      type: 'failure',
      messageId: message.id,
      priority: message.payload.priority,
      errorMessage: error.message
    });
  }

  getReport(): QueueMetricsReport {
    this.cleanup();
    
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Count messages by priority
    const messagesByPriority: Record<Priority, number> = {
      [Priority.URGENT]: 0,
      [Priority.HIGH]: 0,
      [Priority.NORMAL]: 0,
      [Priority.LOW]: 0
    };
    
    const enqueueRecords = this.records.filter(r => r.type === 'enqueue');
    for (const record of enqueueRecords) {
      if (record.priority !== undefined) {
        messagesByPriority[record.priority]++;
      }
    }
    
    // Calculate oldest message age
    let oldestMessageAge = 0;
    if (enqueueRecords.length > 0) {
      const oldestEnqueue = Math.min(...enqueueRecords.map(r => r.timestamp));
      oldestMessageAge = now - oldestEnqueue;
    }
    
    // Calculate average wait time (dequeue time - enqueue time)
    const completeRecords = this.records.filter(r => r.type === 'complete');
    let totalWaitTime = 0;
    let waitTimeCount = 0;
    
    for (const complete of completeRecords) {
      const enqueue = enqueueRecords.find(e => e.messageId === complete.messageId);
      if (enqueue) {
        totalWaitTime += complete.timestamp - enqueue.timestamp;
        waitTimeCount++;
      }
    }
    
    const averageWaitTime = waitTimeCount > 0 ? totalWaitTime / waitTimeCount : 0;
    
    // Calculate throughput
    const recentCompletes = completeRecords.filter(r => r.timestamp > oneMinuteAgo);
    const messagesPerMinute = recentCompletes.length;
    
    // Estimate tokens per minute (would need actual token info)
    const tokensPerMinute = messagesPerMinute * 1000; // Placeholder
    
    return {
      totalMessages: enqueueRecords.length,
      messagesByPriority,
      oldestMessageAge,
      averageWaitTime,
      throughput: {
        messagesPerMinute,
        tokensPerMinute
      }
    };
  }

  cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    this.records = this.records.filter(r => r.timestamp > cutoff);
    
    // Enforce max records
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  private addRecord(record: MetricRecord): void {
    this.records.push(record);
    
    // Opportunistic cleanup
    if (this.records.length > this.maxRecords * 1.2) {
      this.cleanup();
    }
  }
}