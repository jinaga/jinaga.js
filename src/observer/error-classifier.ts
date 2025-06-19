export class ErrorClassifier {
    classify(error: Error): string {
        // Check if this is a network error with ECONNRESET code
        if ((error as any).code === 'ECONNRESET') {
            return 'transient';
        }
        
        // Return 'unknown' for any other error types (minimal implementation)
        return 'unknown';
    }
}