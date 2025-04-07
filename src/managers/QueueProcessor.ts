import { Signal, delay } from "../util/promise";
import { Trace } from "../util/trace";

/**
 * Interface for a component that can save data.
 */
export interface Saver {
    /**
     * Saves data to the network.
     */
    save(): Promise<void>;
}

/**
 * Processes a queue with a debouncing mechanism.
 * This improves performance by batching multiple operations together.
 */
export class QueueProcessor {
    private processingSignal: Signal;
    private delaySignal: Signal;
    private currentProcessingSignal: Signal;
    private processingTask: Promise<void>;
    private disposed: boolean = false;

    /**
     * Creates a new QueueProcessor.
     * @param saver The component that will save the data.
     * @param delayMilliseconds The delay in milliseconds before processing the queue.
     */
    constructor(
        private readonly saver: Saver,
        private readonly delayMilliseconds: number
    ) {
        this.processingSignal = new Signal();
        this.delaySignal = new Signal();
        this.currentProcessingSignal = new Signal();
        this.currentProcessingSignal.signal(); // Initially complete
        
        // Start the background processing task
        this.processingTask = this.processQueueAsync();
    }

    /**
     * Schedules processing of the queue with a delay.
     * This allows multiple operations to be batched together.
     */
    public scheduleProcessing(): void {
        if (this.disposed) {
            throw new Error("QueueProcessor has been disposed");
        }
        
        this.processingSignal.signal();
        this.processingSignal.reset();
    }

    /**
     * Processes the queue immediately, bypassing any delay.
     */
    public async processQueueNow(): Promise<void> {
        if (this.disposed) {
            throw new Error("QueueProcessor has been disposed");
        }
        
        // Reset the signals to cancel any ongoing delay
        this.currentProcessingSignal.reset();
        this.delaySignal.signal();
        
        // Signal processing and wait for it to complete
        this.processingSignal.signal();
        
        // Wait for processing to complete
        await this.currentProcessingSignal.wait();
    }

    /**
     * Background task that continuously monitors for queue processing requests.
     */
    private async processQueueAsync(): Promise<void> {
        try {
            while (!this.disposed) {
                // Wait for a processing signal
                await this.processingSignal.wait();
                
                if (this.disposed) {
                    break;
                }
                
                // Reset for the next processing cycle
                this.currentProcessingSignal.reset();
                
                // If there's a delay configured, wait for it
                if (this.delayMilliseconds > 0) {
                    this.delaySignal.reset();
                    
                    // Create a timeout that will signal after the delay
                    const timeoutPromise = delay(this.delayMilliseconds).then(() => {
                        this.delaySignal.signal();
                    });
                    
                    // Wait for either the delay to complete or to be cancelled
                    await this.delaySignal.wait();
                }
                
                if (this.disposed) {
                    break;
                }
                
                try {
                    // Process the queue by calling saver.save
                    await this.saver.save();
                } 
                catch (error) {
                    Trace.error(error);
                }
                finally {
                    // Signal that processing is complete
                    this.currentProcessingSignal.signal();
                }
            }
        } 
        catch (error) {
            Trace.error(error);
        }
    }

    /**
     * Stops the background processing task.
     */
    public async stopBackgroundProcess(): Promise<void> {
        this.disposed = true;
        this.processingSignal.signal();
        this.delaySignal.signal();
        
        // Wait for the processing task to complete
        try {
            await this.processingTask;
        }
        catch (error) {
            Trace.error(error);
        }
    }

    /**
     * Disposes of the QueueProcessor.
     */
    public async dispose(): Promise<void> {
        if (!this.disposed) {
            await this.stopBackgroundProcess();
        }
    }
}