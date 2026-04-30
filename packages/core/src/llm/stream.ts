/**
 * @module llm/stream
 * EventStream — the core streaming primitive for LLM responses.
 *
 * Supports dual consumption patterns:
 * 1. Async iteration — process events as they arrive (for UI streaming, logging)
 * 2. Promise-based result — await the final aggregated result
 *
 * Adapted from the pi-mono EventStream pattern for the meta-ads-agent.
 */

/**
 * A push-based async stream that buffers events and resolves a final result.
 *
 * Producers push events and eventually call complete() or error().
 * Consumers iterate via for-await-of and/or await the result() promise.
 *
 * @typeParam T - Type of individual stream events
 * @typeParam R - Type of the final result (default: void)
 *
 * @example
 * ```ts
 * // Producer side
 * const stream = new EventStream<string, string>();
 * stream.push('Hello ');
 * stream.push('world');
 * stream.complete('Hello world');
 *
 * // Consumer side — async iteration
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk);
 * }
 * const fullText = await stream.result();
 *
 * // Consumer side — just get result
 * const fullText = await stream.result();
 * ```
 */
export class EventStream<T, R = void> implements AsyncIterable<T> {
  /** Buffered events waiting to be consumed */
  private buffer: T[] = [];

  /** Whether the stream has been completed or errored */
  private done = false;

  /** The final result value (set by complete()) */
  private resultValue: R | undefined;

  /** Error that terminated the stream (set by error()) */
  private streamError: Error | undefined;

  /** Resolver for the next event (set when consumer is waiting) */
  private waitResolve: ((value: IteratorResult<T>) => void) | null = null;

  /** Resolver for the result promise */
  private resultResolve: ((value: R) => void) | null = null;

  /** Rejecter for the result promise */
  private resultReject: ((err: Error) => void) | null = null;

  /** The result promise (created lazily) */
  private resultPromise: Promise<R> | null = null;

  /**
   * Pushes an event into the stream buffer.
   *
   * If a consumer is waiting (via async iteration), the event is
   * delivered immediately. Otherwise, it is buffered until consumed.
   *
   * @param event - The event to push into the stream
   * @throws {Error} If the stream has already been completed or errored
   */
  push(event: T): void {
    if (this.done) {
      throw new Error('Cannot push to a completed or errored stream');
    }

    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  /**
   * Completes the stream with a final result value.
   *
   * After calling complete(), no more events can be pushed.
   * The result() promise resolves with the provided value.
   *
   * @param result - The final result value
   * @throws {Error} If the stream has already been completed or errored
   */
  complete(result: R): void {
    if (this.done) {
      throw new Error('Stream has already been completed or errored');
    }

    this.done = true;
    this.resultValue = result;

    /* Signal waiting iterator that the stream is done */
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve({ value: undefined as unknown as T, done: true });
    }

    /* Resolve the result promise if anyone is waiting */
    if (this.resultResolve) {
      this.resultResolve(result);
    }
  }

  /**
   * Terminates the stream with an error.
   *
   * The error is propagated to both the async iterator and the result promise.
   *
   * @param err - The error that caused the stream to fail
   * @throws {Error} If the stream has already been completed or errored
   */
  error(err: Error): void {
    if (this.done) {
      throw new Error('Stream has already been completed or errored');
    }

    this.done = true;
    this.streamError = err;

    /* Signal waiting iterator */
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve({ value: undefined as unknown as T, done: true });
    }

    /* Reject the result promise */
    if (this.resultReject) {
      this.resultReject(err);
    }
  }

  /**
   * Returns a promise that resolves to the stream's final result.
   *
   * If the stream is already complete, resolves immediately.
   * If the stream errored, rejects with the stream error.
   * Otherwise, waits until complete() or error() is called.
   *
   * @returns Promise resolving to the final result value
   */
  result(): Promise<R> {
    if (this.resultPromise) {
      return this.resultPromise;
    }

    this.resultPromise = new Promise<R>((resolve, reject) => {
      if (this.done) {
        if (this.streamError) {
          reject(this.streamError);
        } else {
          resolve(this.resultValue as R);
        }
        return;
      }

      this.resultResolve = resolve;
      this.resultReject = reject;
    });

    return this.resultPromise;
  }

  /**
   * Implements the AsyncIterable protocol for for-await-of consumption.
   *
   * Events are yielded as they arrive. The iterator completes when
   * the stream is completed or errored. If the stream errored,
   * the error is thrown after all buffered events are consumed.
   *
   * @returns AsyncIterator that yields stream events
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        /* Yield buffered events first */
        if (this.buffer.length > 0) {
          const event = this.buffer.shift()!;
          return Promise.resolve({ value: event, done: false });
        }

        /* Stream is done — check for error */
        if (this.done) {
          if (this.streamError) {
            return Promise.reject(this.streamError);
          }
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }

        /* Wait for the next event */
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waitResolve = resolve;
        });
      },
    };
  }
}
