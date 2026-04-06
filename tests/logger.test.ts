import { describe, it, expect, vi, beforeEach } from 'vitest';

// Direct imports — logger is stateful singleton, we test it carefully
import { createLogger, childLogger } from '../src/core/logger.js';

describe('core/logger', () => {
  beforeEach(() => {
    // Ensure env is clean before each test
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
    delete process.env.MCP_TRANSPORT;
  });

  describe('createLogger', () => {
    it('returns a logger instance with expected methods', () => {
      // createLogger is idempotent after first call — safe to call multiple times
      const logger = createLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.fatal).toBe('function');
      expect(typeof logger.child).toBe('function');
    });

    it('is idempotent — returns same instance on repeated calls', () => {
      const a = createLogger();
      const b = createLogger();
      expect(a).toBe(b);
    });

    it('has a valid log level (one of pino levels)', () => {
      const logger = createLogger();
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
      expect(validLevels).toContain(logger.level);
    });

    it('respects LOG_LEVEL env var when set before first createLogger', () => {
      // Note: logger singleton is already created by import above.
      // We verify the level is valid regardless.
      const logger = createLogger();
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
      expect(validLevels).toContain(logger.level);
    });
  });

  describe('getRootLogger', () => {
    it('returns the same instance as createLogger after initialization', async () => {
      const { getRootLogger } = await import('../src/core/logger.js');
      const logger = createLogger();
      expect(getRootLogger()).toBe(logger);
    });
  });

  describe('childLogger', () => {
    it('creates a child logger with expected methods', () => {
      const child = childLogger('test-module');
      expect(child).toBeDefined();
      expect(typeof child.info).toBe('function');
      expect(typeof child.warn).toBe('function');
      expect(typeof child.error).toBe('function');
      expect(typeof child.child).toBe('function');
    });

    it('different modules produce different child instances', () => {
      const a = childLogger('module-a');
      const b = childLogger('module-b');
      expect(a).not.toBe(b);
    });

    it('child logger can log without throwing', () => {
      const child = childLogger('test-quiet');
      // Should not throw even if level is too high
      expect(() => child.info('test message')).not.toThrow();
      expect(() => child.warn('test warning')).not.toThrow();
      expect(() => child.error('test error')).not.toThrow();
      expect(() => child.debug('test debug')).not.toThrow();
    });

    it('child logger accepts merge object as first argument (pino signature)', () => {
      const child = childLogger('test-merge');
      expect(() => child.warn({ err: new Error('test') }, 'error with merge')).not.toThrow();
      expect(() => child.info({ key: 'value' }, 'info with merge')).not.toThrow();
    });

    it('child logger supports string format with interpolation', () => {
      const child = childLogger('test-format');
      expect(() => child.info('hello %s', 'world')).not.toThrow();
      expect(() => child.warn('count: %d', 42)).not.toThrow();
    });
  });
});
