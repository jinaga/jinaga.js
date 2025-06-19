export class ErrorClassifier {
    classify(error: Error): string {
        // Check if this is a network error with ECONNRESET code
        if ((error as any).code === 'ECONNRESET') {
            return 'transient';
        }
        
        // Check if this is an HTTP 401 authentication error
        if ((error as any).status === 401) {
            return 'authentication';
        }
        
        // Check if this is an HTTP 500 server error
        if ((error as any).status === 500) {
            return 'server';
        }
        
        // Return 'unknown' for any other error types (minimal implementation)
        return 'unknown';
    }
}