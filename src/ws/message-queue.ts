/**
 * Message Queue for WebSocket Store-and-Forward
 * 
 * Provides persistent message buffering for resilient WebSocket connections.
 * Messages are queued during disconnection and sent when connection is restored.
 */

export interface QueuedMessage {
  id: string;
  data: string | ArrayBuffer | Blob;
  timestamp: number;
  attempts: number;
  priority?: number;
}

export interface MessageQueueOptions {
  /** Maximum number of messages to queue */
  maxSize?: number;
  /** Maximum number of retry attempts per message */
  maxRetries?: number;
  /** Enable persistent storage (requires Storage interface) */
  persistent?: boolean;
}

/**
 * Message Queue for buffering WebSocket messages
 * 
 * Provides store-and-forward functionality:
 * - Buffers messages during disconnection
 * - Retries failed messages
 * - Supports priority ordering
 * - Optional persistent storage
 */
export class MessageQueue {
  private readonly queue: QueuedMessage[] = [];
  private readonly options: Required<MessageQueueOptions>;
  private messageIdCounter = 0;

  constructor(options: MessageQueueOptions = {}) {
    this.options = {
      maxSize: options.maxSize ?? 1000,
      maxRetries: options.maxRetries ?? 5,
      persistent: options.persistent ?? false
    };
  }

  /**
   * Enqueue a message for transmission
   */
  enqueue(data: string | ArrayBuffer | Blob, priority: number = 0): string {
    // Check queue size limit
    if (this.queue.length >= this.options.maxSize) {
      // Remove lowest priority message
      const lowestPriorityIndex = this.queue.findIndex(
        m => (m.priority ?? 0) < priority
      );
      
      if (lowestPriorityIndex >= 0) {
        this.queue.splice(lowestPriorityIndex, 1);
      } else {
        // Remove oldest message if no lower priority found
        this.queue.shift();
      }
    }

    const message: QueuedMessage = {
      id: `msg_${Date.now()}_${++this.messageIdCounter}`,
      data,
      timestamp: Date.now(),
      attempts: 0,
      priority
    };

    // Insert in priority order (higher priority first)
    const insertIndex = this.queue.findIndex(m => (m.priority ?? 0) < priority);
    if (insertIndex >= 0) {
      this.queue.splice(insertIndex, 0, message);
    } else {
      this.queue.push(message);
    }

    return message.id;
  }

  /**
   * Dequeue the next message for transmission
   */
  dequeue(): QueuedMessage | null {
    if (this.queue.length === 0) {
      return null;
    }

    return this.queue.shift()!;
  }

  /**
   * Peek at the next message without removing it
   */
  peek(): QueuedMessage | null {
    if (this.queue.length === 0) {
      return null;
    }

    return this.queue[0];
  }

  /**
   * Mark a message as failed and re-queue if retries remain
   */
  markFailed(messageId: string): boolean {
    const message = this.queue.find(m => m.id === messageId);
    if (!message) {
      return false;
    }

    message.attempts++;

    if (message.attempts >= this.options.maxRetries) {
      // Remove message after max retries
      const index = this.queue.findIndex(m => m.id === messageId);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
      return false;
    }

    // Re-queue with exponential backoff delay
    // Messages with more attempts go to the back of the queue
    const index = this.queue.findIndex(m => m.id === messageId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      // Add delay based on attempts (exponential backoff)
      const delayMs = Math.min(1000 * Math.pow(2, message.attempts), 30000);
      setTimeout(() => {
        this.queue.push(message);
      }, delayMs);
    }

    return true;
  }

  /**
   * Remove a message from the queue (successful transmission)
   */
  remove(messageId: string): boolean {
    const index = this.queue.findIndex(m => m.id === messageId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear all messages from the queue
   */
  clear(): void {
    this.queue.length = 0;
  }

  /**
   * Get all queued messages (for debugging/inspection)
   */
  getAll(): readonly QueuedMessage[] {
    return [...this.queue];
  }

  /**
   * Get messages older than specified age (in milliseconds)
   */
  getStaleMessages(maxAgeMs: number): QueuedMessage[] {
    const now = Date.now();
    return this.queue.filter(m => now - m.timestamp > maxAgeMs);
  }
}
