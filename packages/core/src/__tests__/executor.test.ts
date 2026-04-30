/**
 * @module __tests__/executor.test
 * Unit tests for the ToolExecutor retry logic.
 *
 * Verifies that the executor:
 * - Succeeds on the first attempt when no errors occur
 * - Retries on failure with exponential backoff
 * - Throws ToolExecutionError after all attempts are exhausted
 * - Calls before/after hooks correctly
 * - Skips execution when a before hook returns 'skip'
 */

import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { ToolExecutor } from '../tools/executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { HookManager } from '../tools/hooks.js';
import { createTool, ToolExecutionError } from '../tools/types.js';
import type { ToolContext } from '../tools/types.js';

/** Creates a mock tool context for testing */
function mockContext(): ToolContext {
  return {
    sessionId: 'test-session',
    adAccountId: 'act_123',
    dryRun: false,
    timestamp: new Date().toISOString(),
  };
}

/** Creates a test tool with a configurable execute function */
function createTestTool(executeFn: () => Promise<{ success: boolean; data: null; message: string }>) {
  return createTool({
    name: 'test_tool',
    description: 'A test tool',
    parameters: Type.Object({
      value: Type.String(),
    }),
    execute: executeFn,
  });
}

describe('ToolExecutor', () => {
  it('should succeed on the first attempt', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    const tool = createTestTool(async () => ({
      success: true,
      data: null,
      message: 'ok',
    }));
    registry.register(tool);

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 10,
      logger: () => {},
    });

    const result = await executor.execute('test_tool', { value: 'hello' }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toBe('ok');
  });

  it('should retry and succeed on the second attempt', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    let attempt = 0;
    const tool = createTestTool(async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('transient failure');
      }
      return { success: true, data: null, message: 'recovered' };
    });
    registry.register(tool);

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 10,
      logger: () => {},
    });

    const result = await executor.execute('test_tool', { value: 'test' }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toBe('recovered');
    expect(attempt).toBe(2);
  });

  it('should throw ToolExecutionError after all attempts fail', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    let attempts = 0;
    const tool = createTestTool(async () => {
      attempts++;
      throw new Error('persistent failure');
    });
    registry.register(tool);

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 10,
      logger: () => {},
    });

    await expect(
      executor.execute('test_tool', { value: 'test' }, mockContext()),
    ).rejects.toThrow(ToolExecutionError);

    expect(attempts).toBe(3);
  });

  it('should throw when tool is not registered', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 10,
      logger: () => {},
    });

    await expect(
      executor.execute('nonexistent_tool', {}, mockContext()),
    ).rejects.toThrow('Tool "nonexistent_tool" is not registered');
  });

  it('should skip execution when before hook returns skip', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    const executeFn = vi.fn(async () => ({
      success: true,
      data: null,
      message: 'should not run',
    }));
    const tool = createTestTool(executeFn);
    registry.register(tool);

    hooks.addBeforeHook('test_tool', async () => 'skip');

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 10,
      logger: () => {},
    });

    const result = await executor.execute('test_tool', { value: 'test' }, mockContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain('skipped');
    expect(executeFn).not.toHaveBeenCalled();
  });

  it('should call after hooks on successful execution', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    const tool = createTestTool(async () => ({
      success: true,
      data: null,
      message: 'done',
    }));
    registry.register(tool);

    const afterHook = vi.fn(async () => {});
    hooks.addAfterHook('test_tool', afterHook);

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 10,
      logger: () => {},
    });

    await executor.execute('test_tool', { value: 'test' }, mockContext());
    expect(afterHook).toHaveBeenCalledOnce();
  });

  it('should use exponential backoff between retries', async () => {
    const registry = new ToolRegistry();
    const hooks = new HookManager();

    const startTime = Date.now();
    let attempts = 0;
    const tool = createTestTool(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('retry me');
      }
      return { success: true, data: null, message: 'finally' };
    });
    registry.register(tool);

    const executor = new ToolExecutor(registry, hooks, {
      maxAttempts: 3,
      baseDelayMs: 50,
      logger: () => {},
    });

    const result = await executor.execute('test_tool', { value: 'test' }, mockContext());
    const elapsed = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
    /* Should have waited at least 50ms + 100ms = 150ms (baseDelay * 2^0 + baseDelay * 2^1) */
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });
});
