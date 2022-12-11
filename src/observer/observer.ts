export interface Observer<T> {
    initialized(): Promise<void>;
    stop(): Promise<void>;
}