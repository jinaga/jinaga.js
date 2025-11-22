/**
 * Unit tests for MessageQueue
 */

import { MessageQueue, type QueuedMessage } from '../../src/ws/message-queue';

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  describe('Basic Operations', () => {
    it('should start empty', () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('should enqueue messages', () => {
      const id1 = queue.enqueue('Message 1');
      const id2 = queue.enqueue('Message 2');

      expect(queue.size()).toBe(2);
      expect(queue.isEmpty()).toBe(false);
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);
    });

    it('should dequeue messages in order', () => {
      queue.enqueue('Message 1');
      queue.enqueue('Message 2');
      queue.enqueue('Message 3');

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(msg1?.data).toBe('Message 1');
      expect(msg2?.data).toBe('Message 2');
      expect(msg3?.data).toBe('Message 3');
      expect(queue.isEmpty()).toBe(true);
    });

    it('should peek without removing', () => {
      queue.enqueue('Message 1');
      queue.enqueue('Message 2');

      const peek1 = queue.peek();
      const peek2 = queue.peek();

      expect(peek1?.data).toBe('Message 1');
      expect(peek2?.data).toBe('Message 1');
      expect(queue.size()).toBe(2);
    });

    it('should return null when dequeuing empty queue', () => {
      expect(queue.dequeue()).toBeNull();
      expect(queue.peek()).toBeNull();
    });
  });

  describe('Priority Ordering', () => {
    it('should order messages by priority', () => {
      queue.enqueue('Low Priority', 1);
      queue.enqueue('High Priority', 10);
      queue.enqueue('Medium Priority', 5);

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(msg1?.data).toBe('High Priority');
      expect(msg2?.data).toBe('Medium Priority');
      expect(msg3?.data).toBe('Low Priority');
    });

    it('should maintain FIFO for same priority', () => {
      queue.enqueue('First', 5);
      queue.enqueue('Second', 5);
      queue.enqueue('Third', 5);

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(msg1?.data).toBe('First');
      expect(msg2?.data).toBe('Second');
      expect(msg3?.data).toBe('Third');
    });
  });

  describe('Message Removal', () => {
    it('should remove messages by ID', () => {
      const id1 = queue.enqueue('Message 1');
      const id2 = queue.enqueue('Message 2');
      const id3 = queue.enqueue('Message 3');

      expect(queue.remove(id2)).toBe(true);
      expect(queue.size()).toBe(2);

      const msg1 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(msg1?.data).toBe('Message 1');
      expect(msg3?.data).toBe('Message 3');
    });

    it('should return false when removing non-existent message', () => {
      queue.enqueue('Message 1');
      expect(queue.remove('non-existent-id')).toBe(false);
    });
  });

  describe('Failed Message Handling', () => {
    it('should track retry attempts', () => {
      const id = queue.enqueue('Message');
      const message = queue.dequeue();

      expect(message?.attempts).toBe(0);

      queue.markFailed(id!);
      const retried = queue.dequeue();

      expect(retried?.attempts).toBe(1);
    });

    it('should remove message after max retries', () => {
      const queue = new MessageQueue({ maxRetries: 3 });
      const id = queue.enqueue('Message');

      queue.markFailed(id);
      queue.markFailed(id);
      queue.markFailed(id);
      queue.markFailed(id); // Should remove after this

      expect(queue.size()).toBe(0);
      expect(queue.remove(id)).toBe(false);
    });

    it('should re-queue failed messages with delay', async () => {
      const id = queue.enqueue('Message');
      queue.dequeue();

      queue.markFailed(id);

      // Message should be re-queued after delay (200ms delay + 50ms buffer)
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(queue.size()).toBeGreaterThan(0);
    });
  });

  describe('Queue Limits', () => {
    it('should respect max size limit', () => {
      const queue = new MessageQueue({ maxSize: 3 });

      queue.enqueue('Message 1');
      queue.enqueue('Message 2');
      queue.enqueue('Message 3');
      queue.enqueue('Message 4'); // Should remove oldest

      expect(queue.size()).toBe(3);
    });

    it('should remove lowest priority when at limit', () => {
      const queue = new MessageQueue({ maxSize: 2 });

      queue.enqueue('Low Priority', 1);
      queue.enqueue('High Priority', 10);
      queue.enqueue('Medium Priority', 5); // Should remove low priority

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();

      expect(msg1?.data).toBe('High Priority');
      expect(msg2?.data).toBe('Medium Priority');
    });
  });

  describe('Utility Methods', () => {
    it('should clear all messages', () => {
      queue.enqueue('Message 1');
      queue.enqueue('Message 2');
      queue.enqueue('Message 3');

      queue.clear();

      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('should get all messages', () => {
      queue.enqueue('Message 1');
      queue.enqueue('Message 2');

      const all = queue.getAll();

      expect(all).toHaveLength(2);
      expect(all[0].data).toBe('Message 1');
      expect(all[1].data).toBe('Message 2');
    });

    it('should find stale messages', () => {
      const oldId = queue.enqueue('Old Message');
      const oldMessage = queue.dequeue();
      
      // Manually set old timestamp
      if (oldMessage) {
        oldMessage.timestamp = Date.now() - 2000; // 2 seconds ago
        queue.enqueue('New Message');
        // Re-add old message to queue for testing
        (queue as any).queue.push(oldMessage);
      }

      const stale = queue.getStaleMessages(1000); // Older than 1 second

      expect(stale.length).toBeGreaterThan(0);
      expect(stale[0].data).toBe('Old Message');
    });
  });

  describe('Message Properties', () => {
    it('should include timestamp', () => {
      const before = Date.now();
      const id = queue.enqueue('Message');
      const after = Date.now();

      const message = queue.dequeue();

      expect(message?.timestamp).toBeGreaterThanOrEqual(before);
      expect(message?.timestamp).toBeLessThanOrEqual(after);
    });

    it('should support different data types', () => {
      const id1 = queue.enqueue('String');
      const id2 = queue.enqueue(new ArrayBuffer(8));
      const id3 = queue.enqueue(new Blob(['test']));

      expect(queue.size()).toBe(3);

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(typeof msg1?.data).toBe('string');
      expect(msg2?.data).toBeInstanceOf(ArrayBuffer);
      expect(msg3?.data).toBeInstanceOf(Blob);
    });
  });
});
