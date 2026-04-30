/**
 * @module __tests__/stream.test
 * Unit tests for the EventStream class.
 *
 * Tests the dual consumption pattern (async iteration + promise result),
 * push/consume buffering, completion, error propagation, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { EventStream } from '../llm/stream.js';

describe('EventStream', () => {
  it('should push and consume events via async iteration', async () => {
    const stream = new EventStream<string, void>();

    /* Push events asynchronously */
    setTimeout(() => {
      stream.push('hello');
      stream.push(' ');
      stream.push('world');
      stream.complete(undefined as unknown as void);
    }, 10);

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['hello', ' ', 'world']);
  });

  it('should resolve result() with the completion value', async () => {
    const stream = new EventStream<string, string>();

    setTimeout(() => {
      stream.push('chunk1');
      stream.push('chunk2');
      stream.complete('final result');
    }, 10);

    const result = await stream.result();
    expect(result).toBe('final result');
  });

  it('should allow consuming events and then awaiting result', async () => {
    const stream = new EventStream<number, number>();

    setTimeout(() => {
      stream.push(1);
      stream.push(2);
      stream.push(3);
      stream.complete(6);
    }, 10);

    const items: number[] = [];
    for await (const item of stream) {
      items.push(item);
    }

    const sum = await stream.result();
    expect(items).toEqual([1, 2, 3]);
    expect(sum).toBe(6);
  });

  it('should buffer events pushed before iteration starts', async () => {
    const stream = new EventStream<string, string>();

    /* Push events synchronously BEFORE any consumer attaches */
    stream.push('a');
    stream.push('b');
    stream.push('c');
    stream.complete('abc');

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['a', 'b', 'c']);
    expect(await stream.result()).toBe('abc');
  });

  it('should reject result() when stream errors', async () => {
    const stream = new EventStream<string, string>();

    setTimeout(() => {
      stream.push('partial');
      stream.error(new Error('stream failed'));
    }, 10);

    await expect(stream.result()).rejects.toThrow('stream failed');
  });

  it('should propagate errors through async iteration', async () => {
    const stream = new EventStream<string, string>();

    setTimeout(() => {
      stream.push('ok');
      stream.error(new Error('iteration error'));
    }, 10);

    const chunks: string[] = [];
    try {
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    } catch (err: unknown) {
      expect((err as Error).message).toBe('iteration error');
    }

    expect(chunks).toEqual(['ok']);
  });

  it('should throw when pushing to a completed stream', () => {
    const stream = new EventStream<string, string>();
    stream.complete('done');

    expect(() => stream.push('too late')).toThrow('Cannot push to a completed or errored stream');
  });

  it('should throw when completing an already completed stream', () => {
    const stream = new EventStream<string, string>();
    stream.complete('first');

    expect(() => stream.complete('second')).toThrow('Stream has already been completed or errored');
  });

  it('should throw when erroring an already completed stream', () => {
    const stream = new EventStream<string, string>();
    stream.complete('done');

    expect(() => stream.error(new Error('nope'))).toThrow('Stream has already been completed or errored');
  });

  it('should resolve result() immediately for already-completed streams', async () => {
    const stream = new EventStream<string, number>();
    stream.complete(42);

    const result = await stream.result();
    expect(result).toBe(42);
  });
});
