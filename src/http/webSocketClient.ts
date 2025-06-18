import { FactEnvelope } from '../storage';
import { HttpHeaders } from './authenticationProvider';
import { Trace } from '../util/trace';
import { WebSocketGraphProtocolHandler, WebSocketSubscriptionHandler } from './webSocketGraphHandler';
import { 
    serializeSubscriptionMessage, 
    serializeUnsubscribeMessage, 
    serializePingMessage, 
    serializePongMessage,
    parsePingMessage,
    parsePongMessage
} from './webSocketMessages';

export interface WebSocketClientConfig {
    reconnectMaxAttempts: number;
    reconnectBaseDelay: number;
    reconnectMaxDelay: number;
    pingInterval: number;
    pongTimeout: number;
    messageQueueMaxSize: number;
    subscriptionTimeout: number;
    enableLogging: boolean;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

interface Subscription {
    id: string;
    feed: string;
    bookmark: string;
    onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>;
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (err: Error) => void;
    cleanup: () => void;
}

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private subscriptions = new Map<string, Subscription>();
    private subscriptionCounter = 0;
    private reconnectAttempts = 0;
    private messageQueue: string[] = [];
    private protocolHandler = new WebSocketGraphProtocolHandler();
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private connectionTimeout: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private destroyed = false;

    constructor(
        private readonly wsUrl: string,
        private readonly getHeaders: () => Promise<HttpHeaders>,
        private readonly config: WebSocketClientConfig
    ) {}

    streamFeed(
        feed: string,
        bookmark: string,
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>,
        onBookmark: (bookmark: string) => Promise<void>,
        onError: (err: Error) => void
    ): () => void {
        if (this.config.enableLogging) {
            console.log('streamFeed called, current state:', this.connectionState);
        }

        const subscriptionId = this.generateSubscriptionId();
        
        const subscription: Subscription = {
            id: subscriptionId,
            feed,
            bookmark,
            onEnvelope,
            onBookmark,
            onError,
            cleanup: () => this.unsubscribe(subscriptionId)
        };

        this.subscriptions.set(subscriptionId, subscription);

        // Create subscription handler for protocol handler
        const handler: WebSocketSubscriptionHandler = {
            onFactEnvelopes: onEnvelope,
            onBookmark,
            onError
        };
        this.protocolHandler.addSubscription(subscriptionId, handler);

        // Connect if not already connected
        if (this.connectionState === 'disconnected') {
            if (this.config.enableLogging) {
                console.log('Starting connection...');
            }
            this.connect();
        }

        // Send subscription message (will be queued if not connected)
        this.sendSubscriptionMessage(subscription);

        return subscription.cleanup;
    }

    isConnected(): boolean {
        const wsOpen = 1; // WebSocket.OPEN constant
        return this.connectionState === 'connected' && this.ws?.readyState === wsOpen;
    }

    getStats(): { webSocketConnected: boolean; activeSubscriptions: number; reconnectAttempts: number; } {
        return {
            webSocketConnected: this.isConnected(),
            activeSubscriptions: this.subscriptions.size,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    destroy(): void {
        this.destroyed = true;
        this.clearTimeouts();
        
        // Close WebSocket connection
        if (this.ws) {
            this.ws.close(1000, 'Client destroyed');
            this.ws = null;
        }

        // Clear all subscriptions
        this.subscriptions.clear();
        this.protocolHandler = new WebSocketGraphProtocolHandler();
        this.connectionState = 'disconnected';
    }

    private generateSubscriptionId(): string {
        return `sub_${++this.subscriptionCounter}_${Date.now()}`;
    }

    private async connect(): Promise<void> {
        if (this.destroyed || this.connectionState === 'connecting' || this.connectionState === 'connected') {
            return;
        }

        this.connectionState = 'connecting';
        
        try {
            const headers = await this.getHeaders();
            const authParams = this.buildAuthParams(headers);
            const wsUrl = `${this.wsUrl}${authParams}`;

            if (this.config.enableLogging) {
                console.log('Creating WebSocket connection to:', wsUrl);
            }

            this.ws = new WebSocket(wsUrl);
            this.setupWebSocketHandlers();
            this.setupConnectionTimeout();
            
            // For testing environments, trigger immediate connection if available
            if ((this.ws as any).connectImmediately) {
                (this.ws as any).connectImmediately();
            }

        } catch (error) {
            if (this.config.enableLogging) {
                console.error('Connection error:', error);
            }
            this.handleConnectionError(error as Error);
        }
    }

    private buildAuthParams(headers: HttpHeaders): string {
        const authHeader = headers.Authorization;
        if (authHeader) {
            return `?auth=${encodeURIComponent(authHeader)}`;
        }
        return '';
    }

    private setupWebSocketHandlers(): void {
        if (!this.ws) return;

        this.ws.onopen = () => {
            this.clearConnectionTimeout();
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            
            if (this.config.enableLogging) {
                Trace.info('WebSocket connected');
            }

            // Process queued messages
            this.processMessageQueue();
            
            // Start heartbeat
            this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
            this.clearTimeouts();
            
            if (this.config.enableLogging) {
                Trace.info(`WebSocket closed: ${event.code} ${event.reason}`);
            }

            if (!this.destroyed && event.code !== 1000) {
                // Unexpected disconnection - attempt reconnection
                this.handleUnexpectedDisconnection();
            } else {
                this.connectionState = 'disconnected';
            }
        };

        this.ws.onerror = (event) => {
            this.handleConnectionError(new Error('WebSocket connection error'));
        };
    }

    private setupConnectionTimeout(): void {
        this.connectionTimeout = setTimeout(() => {
            if (this.connectionState === 'connecting') {
                this.handleConnectionError(new Error('Connection timeout'));
            }
        }, this.config.subscriptionTimeout);
    }

    private clearConnectionTimeout(): void {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    private clearTimeouts(): void {
        this.clearConnectionTimeout();
        
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    private handleMessage(data: string): void {
        try {
            // Check for ping message and respond with pong
            const pingMsg = parsePingMessage(data);
            if (pingMsg) {
                this.sendPong(pingMsg.timestamp);
                return;
            }

            // Check for pong message
            const pongMsg = parsePongMessage(data);
            if (pongMsg) {
                this.handlePong();
                return;
            }

            // Process other messages through protocol handler
            this.protocolHandler.processData(data);
            
        } catch (error) {
            if (this.config.enableLogging) {
                Trace.warn(`Failed to process WebSocket message: ${error}`);
            }
        }
    }

    private sendPong(timestamp: number): void {
        const pongMessage = serializePongMessage(timestamp);
        this.sendMessage(pongMessage);
    }

    private handlePong(): void {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    private startHeartbeat(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        this.pingInterval = setInterval(() => {
            if (this.isConnected()) {
                this.sendPing();
            }
        }, this.config.pingInterval);
    }

    private sendPing(): void {
        const timestamp = Date.now();
        const pingMessage = serializePingMessage({ type: 'ping', timestamp });
        this.sendMessage(pingMessage);

        // Set pong timeout
        this.pongTimeout = setTimeout(() => {
            if (this.config.enableLogging) {
                Trace.warn('Pong timeout - connection may be stale');
            }
            // Could trigger reconnection here if needed
        }, this.config.pongTimeout);
    }

    private sendMessage(message: string): void {
        if (this.isConnected() && this.ws) {
            try {
                this.ws.send(message);
            } catch (error) {
                this.queueMessage(message);
            }
        } else {
            this.queueMessage(message);
        }
    }

    private queueMessage(message: string): void {
        if (this.messageQueue.length >= this.config.messageQueueMaxSize) {
            // Remove oldest message to make room
            this.messageQueue.shift();
        }
        this.messageQueue.push(message);
    }

    private processMessageQueue(): void {
        const messagesToSend = [...this.messageQueue];
        this.messageQueue = [];
        
        for (const message of messagesToSend) {
            if (this.isConnected() && this.ws) {
                try {
                    this.ws.send(message);
                } catch (error) {
                    // Put message back in queue
                    this.messageQueue.unshift(message);
                    break;
                }
            } else {
                // Put message back in queue
                this.messageQueue.unshift(message);
                break;
            }
        }
    }

    private sendSubscriptionMessage(subscription: Subscription): void {
        const message = serializeSubscriptionMessage({
            type: 'subscription',
            subscriptionId: subscription.id,
            feed: subscription.feed,
            bookmark: subscription.bookmark
        });
        this.sendMessage(message);
    }

    private unsubscribe(subscriptionId: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) {
            // Remove from local tracking first
            this.subscriptions.delete(subscriptionId);
            this.protocolHandler.removeSubscription(subscriptionId);

            // Send unsubscribe message if connected
            if (this.isConnected()) {
                const message = serializeUnsubscribeMessage({
                    type: 'unsubscribe',
                    subscriptionId
                });
                this.sendMessage(message);
            }

            // Close connection if no subscriptions remain
            if (this.subscriptions.size === 0) {
                this.closeConnection();
            }
        }
    }

    private closeConnection(): void {
        if (this.ws) {
            this.ws.close(1000, 'No active subscriptions');
        }
    }

    private resubscribeAll(): void {
        for (const subscription of this.subscriptions.values()) {
            this.sendSubscriptionMessage(subscription);
        }
    }

    private handleConnectionError(error: Error): void {
        this.clearTimeouts();
        this.connectionState = 'disconnected';
        
        if (this.config.enableLogging) {
            Trace.error(`WebSocket connection error: ${error.message}`);
        }

        // Notify all subscription handlers
        for (const subscription of this.subscriptions.values()) {
            subscription.onError(error);
        }

        if (!this.destroyed && this.subscriptions.size > 0) {
            this.attemptReconnection();
        }
    }

    private handleUnexpectedDisconnection(): void {
        this.connectionState = 'disconnected';
        
        if (!this.destroyed && this.subscriptions.size > 0) {
            this.attemptReconnection();
        }
    }

    private attemptReconnection(): void {
        if (this.destroyed || this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
            this.connectionState = 'failed';
            
            const error = new Error('Max reconnection attempts exceeded');
            for (const subscription of this.subscriptions.values()) {
                subscription.onError(error);
            }
            return;
        }

        this.connectionState = 'reconnecting';
        this.reconnectAttempts++;

        const delay = Math.min(
            this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.config.reconnectMaxDelay
        );

        if (this.config.enableLogging) {
            Trace.info(`Attempting reconnection ${this.reconnectAttempts}/${this.config.reconnectMaxAttempts} in ${delay}ms`);
        }

        this.reconnectTimeout = setTimeout(() => {
            this.connect();
        }, delay);
    }
}