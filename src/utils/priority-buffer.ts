import type { QueueMessage } from '../types/index.js';
import { Priority } from '../types/index.js';

interface BufferItem<T> {
  message: QueueMessage<T>;
  priority: Priority;
  score?: number;
}

export class PriorityBuffer<T> {
  private buffer: BufferItem<T>[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  add(message: QueueMessage<T>, priority: Priority, score?: number): boolean {
    if (this.buffer.length >= this.maxSize) {
      // Remove lowest priority item if buffer is full
      const lowestIndex = this.findLowestPriorityIndex();
      if (lowestIndex !== -1 && this.comparePriority(priority, this.buffer[lowestIndex]!.priority) < 0) {
        this.buffer.splice(lowestIndex, 1);
      } else {
        return false; // Can't add, buffer full with higher priority items
      }
    }

    this.buffer.push({ message, priority, score });
    this.sortBuffer();
    return true;
  }

  remove(message: QueueMessage<T>): boolean {
    const index = this.buffer.findIndex(item => item.message.id === message.id);
    if (index !== -1) {
      this.buffer.splice(index, 1);
      return true;
    }
    return false;
  }

  peekByPriority(limit?: number): QueueMessage<T>[] {
    const resultLimit = limit || this.buffer.length;
    return this.buffer
      .slice(0, resultLimit)
      .map(item => item.message);
  }

  peekByScore(limit?: number): QueueMessage<T>[] {
    const sorted = [...this.buffer]
      .filter(item => item.score !== undefined)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    
    const resultLimit = limit || sorted.length;
    return sorted
      .slice(0, resultLimit)
      .map(item => item.message);
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }

  updateScore(messageId: string, score: number): boolean {
    const item = this.buffer.find(item => item.message.id === messageId);
    if (item) {
      item.score = score;
      return true;
    }
    return false;
  }

  getAll(): QueueMessage<T>[] {
    return this.buffer.map(item => item.message);
  }

  private sortBuffer(): void {
    this.buffer.sort((a, b) => this.comparePriority(a.priority, b.priority));
  }

  private comparePriority(a: Priority, b: Priority): number {
    return a - b; // Lower enum value = higher priority
  }

  private findLowestPriorityIndex(): number {
    if (this.buffer.length === 0) return -1;
    
    let lowestIndex = 0;
    let lowestPriority = this.buffer[0]!.priority;

    for (let i = 1; i < this.buffer.length; i++) {
      if (this.buffer[i]!.priority > lowestPriority) {
        lowestPriority = this.buffer[i]!.priority;
        lowestIndex = i;
      }
    }

    return lowestIndex;
  }
}