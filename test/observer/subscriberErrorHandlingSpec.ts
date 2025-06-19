import { Subscriber } from '../../src/observer/subscriber';
import { ErrorClassifier } from '../../src/observer/error-classifier';

describe('Subscriber Error Handling', () => {
    it('should classify network errors as transient', () => {
        // Create a mock network error that would typically be transient
        const networkError = new Error('Network request failed');
        (networkError as any).code = 'ECONNRESET';
        
        // Test the ErrorClassifier to classify the error
        const errorClassifier = new ErrorClassifier();
        const errorType = errorClassifier.classify(networkError);
        
        expect(errorType).toBe('transient');
    });

    it('should classify 401 errors as authentication', () => {
        // Create a mock HTTP error with 401 status
        const authError = new Error('Unauthorized');
        (authError as any).status = 401;
        
        // Test the ErrorClassifier to classify the error
        const errorClassifier = new ErrorClassifier();
        const errorType = errorClassifier.classify(authError);
        
        expect(errorType).toBe('authentication');
    });
});