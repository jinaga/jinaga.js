import { FactEnvelope } from '../storage';
import { GraphDeserializer } from './deserializer';
import { parseBookmarkMessage, parseErrorMessage, parsePingMessage, parsePongMessage } from './webSocketMessages';

export interface WebSocketSubscriptionHandler {
    onFactEnvelopes: (envelopes: FactEnvelope[]) => Promise<void>;
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (error: Error) => void;
}

export class WebSocketGraphProtocolHandler {
    private subscriptions = new Map<string, WebSocketSubscriptionHandler>();
    private lineBuffer = '';

    constructor() {}

    addSubscription(subscriptionId: string, handler: WebSocketSubscriptionHandler): void {
        this.subscriptions.set(subscriptionId, handler);
    }

    removeSubscription(subscriptionId: string): void {
        this.subscriptions.delete(subscriptionId);
    }

    async processData(data: string): Promise<void> {
        if (!data) {
            return;
        }

        // Add new data to buffer
        this.lineBuffer += data;

        // Process complete blocks (ending with \n\n)
        const blocks = this.lineBuffer.split('\n\n');
        
        // Keep the last incomplete block in buffer
        this.lineBuffer = blocks.pop() || '';

        // Process each complete block
        for (const block of blocks) {
            if (block.trim()) {
                await this.processBlock(block + '\n\n');
            }
        }
    }

    private async processBlock(block: string): Promise<void> {
        const lines = block.split('\n');
        const firstLine = lines[0];

        try {
            // Handle control messages
            if (firstLine.startsWith('BM')) {
                await this.handleBookmarkMessage(block);
            } else if (firstLine.startsWith('ERR')) {
                await this.handleErrorMessage(block);
            } else if (firstLine === 'PING') {
                // Ping messages don't need subscription routing
                return;
            } else if (firstLine === 'PONG') {
                // Pong messages don't need subscription routing
                return;
            } else if (firstLine.startsWith('PK') || firstLine.startsWith('"')) {
                // Graph Protocol data - process with deserializer
                await this.processGraphData(block);
            }
        } catch (error) {
            // Handle malformed messages gracefully
            console.warn('Failed to process WebSocket block:', error);
        }
    }

    private async handleBookmarkMessage(block: string): Promise<void> {
        try {
            const bookmarkMsg = parseBookmarkMessage(block);
            if (bookmarkMsg) {
                const handler = this.subscriptions.get(bookmarkMsg.subscriptionId);
                if (handler) {
                    await handler.onBookmark(bookmarkMsg.bookmark);
                }
            }
        } catch (error) {
            const subscriptionId = this.extractSubscriptionId(block, 'BM');
            const handler = this.subscriptions.get(subscriptionId);
            if (handler) {
                handler.onError(new Error('Invalid bookmark format'));
            }
        }
    }

    private async handleErrorMessage(block: string): Promise<void> {
        try {
            const errorMsg = parseErrorMessage(block);
            if (errorMsg) {
                const handler = this.subscriptions.get(errorMsg.subscriptionId);
                if (handler) {
                    handler.onError(new Error(errorMsg.error));
                }
            }
        } catch (error) {
            const subscriptionId = this.extractSubscriptionId(block, 'ERR');
            const handler = this.subscriptions.get(subscriptionId);
            if (handler) {
                handler.onError(new Error('Invalid error format'));
            }
        }
    }

    private extractSubscriptionId(block: string, prefix: string): string {
        const lines = block.split('\n');
        const firstLine = lines[0];
        if (firstLine.startsWith(prefix)) {
            return firstLine.substring(prefix.length);
        }
        return '';
    }

    private async processGraphData(block: string): Promise<void> {
        // Create a line reader for the deserializer
        const lines = block.split('\n');
        let lineIndex = 0;
        
        const readLine = async (): Promise<string | null> => {
            while (lineIndex < lines.length) {
                const line = lines[lineIndex++];
                // Skip the final empty lines that mark the end of the block
                if (lineIndex === lines.length && line === '') {
                    return null;
                }
                return line;
            }
            return null;
        };

        const deserializer = new GraphDeserializer(readLine);
        
        // Process the graph data and send to all active subscriptions
        await deserializer.read(async (envelopes: FactEnvelope[]) => {
            if (envelopes.length > 0) {
                // Send envelopes to all active subscription handlers
                const promises: Promise<void>[] = [];
                for (const handler of this.subscriptions.values()) {
                    promises.push(handler.onFactEnvelopes(envelopes));
                }
                await Promise.all(promises);
            }
        });
    }
}