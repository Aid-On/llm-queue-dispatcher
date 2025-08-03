import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/in-memory.js';
import { Priority } from '../types/index.js';
import type { LLMRequest } from '../types/index.js';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage<LLMRequest>;

  const createRequest = (id: string, priority: Priority = Priority.NORMAL): LLMRequest => ({
    id,
    payload: { prompt: 'test prompt' },
    priority,
    tokenInfo: { estimated: 100 },
    createdAt: new Date()
  });

  beforeEach(() => {
    storage = new InMemoryStorage<LLMRequest>();
  });

  describe('enqueue', () => {
    it('should enqueue messages with unique ids', async () => {
      const request = createRequest('test-1');
      const message = await storage.enqueue(request);

      expect(message.id).toBeDefined();
      expect(message.payload).toEqual(request);
      expect(message.attributes.receiptHandle).toBeDefined();
      expect(message.attributes.receiveCount).toBe(0);
    });

    it('should assign sequential message ids', async () => {
      const msg1 = await storage.enqueue(createRequest('req-1'));
      const msg2 = await storage.enqueue(createRequest('req-2'));

      expect(msg1.id).toBe('msg-1');
      expect(msg2.id).toBe('msg-2');
    });
  });

  describe('dequeue', () => {
    it('should return messages within visibility timeout', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));

      const messages = await storage.dequeue(10, 30);
      expect(messages).toHaveLength(2);
      
      messages.forEach(msg => {
        expect(msg.attributes.receiveCount).toBe(1);
        expect(msg.attributes.firstReceivedAt).toBeDefined();
      });
    });

    it('should respect limit parameter', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));
      await storage.enqueue(createRequest('test-3'));

      const messages = await storage.dequeue(2, 30);
      expect(messages).toHaveLength(2);
    });

    it('should not return messages already in flight', async () => {
      await storage.enqueue(createRequest('test-1'));

      const first = await storage.dequeue(1, 30);
      expect(first).toHaveLength(1);

      const second = await storage.dequeue(1, 30);
      expect(second).toHaveLength(0); // Should be empty since message is in flight
    });

    it('should update receipt handles on each dequeue', async () => {
      await storage.enqueue(createRequest('test-1'));

      const first = await storage.dequeue(1, 1); // 1 second visibility
      const originalHandle = first[0]?.attributes.receiptHandle;

      // Wait for visibility timeout to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const second = await storage.dequeue(1, 30);
      expect(second).toHaveLength(1);
      expect(second[0]?.attributes.receiptHandle).not.toBe(originalHandle);
      expect(second[0]?.attributes.receiveCount).toBe(2);
    });
  });

  describe('deleteMessage', () => {
    it('should delete messages by receipt handle', async () => {
      await storage.enqueue(createRequest('test-1'));
      const messages = await storage.dequeue(1, 30);
      const receiptHandle = messages[0]?.attributes.receiptHandle;
      expect(receiptHandle).toBeDefined();

      await storage.deleteMessage(receiptHandle!);

      // Message should be gone
      expect(storage.getAllMessages()).toHaveLength(0);
      expect(storage.getInFlightMessages().size).toBe(0);
    });

    it('should throw error for invalid receipt handle', async () => {
      await expect(storage.deleteMessage('invalid-handle'))
        .rejects.toThrow('Message with receipt handle invalid-handle not found');
    });
  });

  describe('updateVisibilityTimeout', () => {
    it('should update visibility timeout for in-flight messages', async () => {
      await storage.enqueue(createRequest('test-1'));
      const messages = await storage.dequeue(1, 1); // 1 second
      const receiptHandle = messages[0]?.attributes.receiptHandle;
      expect(receiptHandle).toBeDefined();

      await storage.updateVisibilityTimeout(receiptHandle!, 60); // Extend to 60 seconds

      // Message should still be in flight
      const newMessages = await storage.dequeue(1, 30);
      expect(newMessages).toHaveLength(0);
    });

    it('should throw error for invalid receipt handle', async () => {
      await expect(storage.updateVisibilityTimeout('invalid-handle', 30))
        .rejects.toThrow('Message with receipt handle invalid-handle not found');
    });
  });

  describe('getApproximateMessageCount', () => {
    it('should return count of available messages', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));

      expect(await storage.getApproximateMessageCount()).toBe(2);

      // Dequeue one
      await storage.dequeue(1, 30);
      expect(await storage.getApproximateMessageCount()).toBe(1);
    });
  });

  describe('peekMessagesByPriority', () => {
    it('should return messages with specified priority', async () => {
      await storage.enqueue(createRequest('high-1', Priority.HIGH));
      await storage.enqueue(createRequest('normal-1', Priority.NORMAL));
      await storage.enqueue(createRequest('high-2', Priority.HIGH));

      const highPriorityMessages = await storage.peekMessagesByPriority(Priority.HIGH, 10);
      expect(highPriorityMessages).toHaveLength(2);
      expect(highPriorityMessages.every(msg => msg.payload.priority === Priority.HIGH)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      await storage.enqueue(createRequest('high-1', Priority.HIGH));
      await storage.enqueue(createRequest('high-2', Priority.HIGH));
      await storage.enqueue(createRequest('high-3', Priority.HIGH));

      const messages = await storage.peekMessagesByPriority(Priority.HIGH, 2);
      expect(messages).toHaveLength(2);
    });

    it('should not return in-flight messages', async () => {
      await storage.enqueue(createRequest('high-1', Priority.HIGH));
      await storage.enqueue(createRequest('high-2', Priority.HIGH));

      // Make one message in-flight
      await storage.dequeue(1, 30);

      const available = await storage.peekMessagesByPriority(Priority.HIGH, 10);
      expect(available).toHaveLength(1);
    });
  });

  describe('batch operations', () => {
    it('should support batch enqueue', async () => {
      const requests = [
        createRequest('batch-1'),
        createRequest('batch-2'),
        createRequest('batch-3')
      ];

      const messages = await storage.batchEnqueue!(requests);
      expect(messages).toHaveLength(3);
      expect(await storage.getApproximateMessageCount()).toBe(3);
    });

    it('should support batch delete', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));

      const messages = await storage.dequeue(2, 30);
      const handles = messages.map(msg => msg.attributes.receiptHandle);

      await storage.batchDelete!(handles);

      expect(storage.getAllMessages()).toHaveLength(0);
      expect(storage.getInFlightMessages().size).toBe(0);
    });
  });

  describe('getQueueAttributes', () => {
    it('should return queue statistics', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));

      // Dequeue one to make it in-flight
      await storage.dequeue(1, 30);

      const attrs = await storage.getQueueAttributes!();
      expect(attrs.approximateNumberOfMessages).toBe(1);
      expect(attrs.approximateNumberOfMessagesInFlight).toBe(1);
      expect(attrs.createdTimestamp).toBeDefined();
      expect(attrs.lastModifiedTimestamp).toBeDefined();
    });
  });

  describe('purge', () => {
    it('should remove all messages', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));
      await storage.dequeue(1, 30); // Make one in-flight

      await storage.purge!();

      expect(storage.getAllMessages()).toHaveLength(0);
      expect(storage.getInFlightMessages().size).toBe(0);
      expect(await storage.getApproximateMessageCount()).toBe(0);
    });
  });

  describe('testing helpers', () => {
    it('should provide getAllMessages for testing', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.enqueue(createRequest('test-2'));

      const allMessages = storage.getAllMessages();
      expect(allMessages).toHaveLength(2);
    });

    it('should provide getInFlightMessages for testing', async () => {
      await storage.enqueue(createRequest('test-1'));
      await storage.dequeue(1, 30);

      const inFlight = storage.getInFlightMessages();
      expect(inFlight.size).toBe(1);
    });
  });
});