import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityBuffer } from '../utils/priority-buffer.js';
import { Priority } from '../types/index.js';
import type { QueueMessage, LLMRequest } from '../types/index.js';

describe('PriorityBuffer', () => {
  let buffer: PriorityBuffer<LLMRequest>;

  const createMessage = (id: string, priority: Priority): QueueMessage<LLMRequest> => ({
    id,
    payload: {
      id,
      payload: { prompt: 'test' },
      priority,
      tokenInfo: { estimated: 100 },
      createdAt: new Date()
    },
    attributes: {
      messageId: id,
      receiptHandle: `receipt-${id}`,
      enqueuedAt: new Date(),
      receiveCount: 0
    }
  });

  beforeEach(() => {
    buffer = new PriorityBuffer<LLMRequest>(5);
  });

  describe('add', () => {
    it('should add messages in priority order', () => {
      const msg1 = createMessage('1', Priority.LOW);
      const msg2 = createMessage('2', Priority.HIGH);
      const msg3 = createMessage('3', Priority.URGENT);

      expect(buffer.add(msg1, Priority.LOW)).toBe(true);
      expect(buffer.add(msg2, Priority.HIGH)).toBe(true);
      expect(buffer.add(msg3, Priority.URGENT)).toBe(true);

      const peeked = buffer.peekByPriority();
      expect(peeked[0]?.id).toBe('3'); // URGENT
      expect(peeked[1]?.id).toBe('2'); // HIGH
      expect(peeked[2]?.id).toBe('1'); // LOW
    });

    it('should respect buffer size limit', () => {
      for (let i = 0; i < 5; i++) {
        const msg = createMessage(`${i}`, Priority.NORMAL);
        expect(buffer.add(msg, Priority.NORMAL)).toBe(true);
      }

      // Buffer is full, try to add low priority
      const lowMsg = createMessage('low', Priority.LOW);
      expect(buffer.add(lowMsg, Priority.LOW)).toBe(false);

      // Buffer is full, but high priority should replace lowest
      const highMsg = createMessage('high', Priority.URGENT);
      expect(buffer.add(highMsg, Priority.URGENT)).toBe(true);
      expect(buffer.size()).toBe(5);
    });

    it('should store scores with messages', () => {
      const msg = createMessage('1', Priority.NORMAL);
      buffer.add(msg, Priority.NORMAL, 0.75);

      const byScore = buffer.peekByScore();
      expect(byScore[0]?.id).toBe('1');
    });
  });

  describe('remove', () => {
    it('should remove messages by id', () => {
      const msg1 = createMessage('1', Priority.NORMAL);
      const msg2 = createMessage('2', Priority.NORMAL);

      buffer.add(msg1, Priority.NORMAL);
      buffer.add(msg2, Priority.NORMAL);

      expect(buffer.size()).toBe(2);
      expect(buffer.remove(msg1)).toBe(true);
      expect(buffer.size()).toBe(1);
      expect(buffer.remove(msg1)).toBe(false); // Already removed
    });
  });

  describe('peekByPriority', () => {
    it('should return messages in priority order', () => {
      buffer.add(createMessage('1', Priority.LOW), Priority.LOW);
      buffer.add(createMessage('2', Priority.NORMAL), Priority.NORMAL);
      buffer.add(createMessage('3', Priority.HIGH), Priority.HIGH);
      buffer.add(createMessage('4', Priority.URGENT), Priority.URGENT);

      const messages = buffer.peekByPriority();
      expect(messages.map(m => m.id)).toEqual(['4', '3', '2', '1']);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        buffer.add(createMessage(`${i}`, Priority.NORMAL), Priority.NORMAL);
      }

      const limited = buffer.peekByPriority(3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('peekByScore', () => {
    it('should return messages sorted by score', () => {
      buffer.add(createMessage('1', Priority.NORMAL), Priority.NORMAL, 0.3);
      buffer.add(createMessage('2', Priority.NORMAL), Priority.NORMAL, 0.9);
      buffer.add(createMessage('3', Priority.NORMAL), Priority.NORMAL, 0.6);

      const byScore = buffer.peekByScore();
      expect(byScore.map(m => m.id)).toEqual(['2', '3', '1']);
    });

    it('should filter out messages without scores', () => {
      buffer.add(createMessage('1', Priority.NORMAL), Priority.NORMAL, 0.5);
      buffer.add(createMessage('2', Priority.NORMAL), Priority.NORMAL); // No score
      buffer.add(createMessage('3', Priority.NORMAL), Priority.NORMAL, 0.7);

      const byScore = buffer.peekByScore();
      expect(byScore).toHaveLength(2);
      expect(byScore.map(m => m.id)).toEqual(['3', '1']);
    });
  });

  describe('updateScore', () => {
    it('should update score for existing message', () => {
      const msg = createMessage('1', Priority.NORMAL);
      buffer.add(msg, Priority.NORMAL, 0.3);

      expect(buffer.updateScore('1', 0.8)).toBe(true);
      
      const byScore = buffer.peekByScore();
      expect(byScore[0]?.id).toBe('1');
    });

    it('should return false for non-existent message', () => {
      expect(buffer.updateScore('non-existent', 0.5)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all messages', () => {
      buffer.add(createMessage('1', Priority.NORMAL), Priority.NORMAL);
      buffer.add(createMessage('2', Priority.NORMAL), Priority.NORMAL);

      expect(buffer.size()).toBe(2);
      buffer.clear();
      expect(buffer.size()).toBe(0);
    });
  });
});