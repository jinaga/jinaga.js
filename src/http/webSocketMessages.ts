// WebSocket message types and protocol utilities

export interface SubscriptionMessage {
    type: 'subscription';
    subscriptionId: string;
    feed: string;
    bookmark: string;
}

export interface UnsubscribeMessage {
    type: 'unsubscribe';
    subscriptionId: string;
}

export interface PingMessage {
    type: 'ping';
    timestamp: number;
}

export type ClientMessage = SubscriptionMessage | UnsubscribeMessage | PingMessage;

// Graph Protocol serialization functions
export function serializeSubscriptionMessage(message: SubscriptionMessage): string {
    return `SUB${message.subscriptionId}\n"${message.feed}"\n"${message.bookmark}"\n\n`;
}

export function serializeUnsubscribeMessage(message: UnsubscribeMessage): string {
    return `UNSUB${message.subscriptionId}\n\n`;
}

export function serializePingMessage(message: PingMessage): string {
    return `PING\n${message.timestamp}\n\n`;
}

export function serializePongMessage(timestamp: number): string {
    return `PONG\n${timestamp}\n\n`;
}

// Message parsing utilities
export interface BookmarkMessage {
    subscriptionId: string;
    bookmark: string;
}

export interface ErrorMessage {
    subscriptionId: string;
    error: string;
}

export interface PingPongMessage {
    timestamp: number;
}

export function parseBookmarkMessage(data: string): BookmarkMessage | null {
    const lines = data.split('\n');
    if (lines.length < 3 || !lines[0].startsWith('BM')) {
        return null;
    }
    
    try {
        const subscriptionId = lines[0].substring(2);
        const bookmark = JSON.parse(lines[1]);
        return { subscriptionId, bookmark };
    } catch (error) {
        throw new Error('Invalid bookmark format');
    }
}

export function parseErrorMessage(data: string): ErrorMessage | null {
    const lines = data.split('\n');
    if (lines.length < 3 || !lines[0].startsWith('ERR')) {
        return null;
    }
    
    try {
        const subscriptionId = lines[0].substring(3);
        const error = JSON.parse(lines[1]);
        return { subscriptionId, error };
    } catch (error) {
        throw new Error('Invalid error format');
    }
}

export function parsePingMessage(data: string): PingPongMessage | null {
    const lines = data.split('\n');
    if (lines.length < 3 || lines[0] !== 'PING') {
        return null;
    }
    
    const timestamp = parseInt(lines[1]);
    if (isNaN(timestamp)) {
        return null;
    }
    
    return { timestamp };
}

export function parsePongMessage(data: string): PingPongMessage | null {
    const lines = data.split('\n');
    if (lines.length < 3 || lines[0] !== 'PONG') {
        return null;
    }
    
    const timestamp = parseInt(lines[1]);
    if (isNaN(timestamp)) {
        return null;
    }
    
    return { timestamp };
}