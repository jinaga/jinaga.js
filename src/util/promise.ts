export function delay(ms: number) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * A signal that can be waited on and triggered.
 * Used for coordinating asynchronous operations.
 */
export class Signal {
  private _promise!: Promise<void>;
  private _resolve!: () => void;
  private _reject!: (error: Error) => void;

  constructor() {
    this.reset();
  }

  /**
   * Resets the signal to its initial state.
   */
  public reset(): void {
    this._promise = new Promise<void>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  /**
   * Signals that the operation is complete.
   */
  public signal(): void {
    this._resolve();
  }

  /**
   * Signals an error.
   * @param error The error that occurred.
   */
  public error(error: Error): void {
    this._reject(error);
  }

  /**
   * Waits for the signal to be triggered.
   */
  public async wait(): Promise<void> {
    return this._promise;
  }
}
