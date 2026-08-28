/**
 * health/checker.spec.ts — Tests for HealthChecker (SCALE-001).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HealthChecker } from './checker.js';
import type { ComponentHealth } from './types.js';

describe('SCALE-001: HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
  });

  describe('register() and check()', () => {
    it('returns healthy with no components', async () => {
      const result = await checker.check();
      expect(result.status).toBe('healthy');
      expect(result.components).toEqual([]);
    });

    it('reports healthy when all components are healthy', async () => {
      checker.register('db', () => ({
        name: 'db', status: 'healthy', ready: true, message: 'ok',
      }));
      const result = await checker.check();
      expect(result.status).toBe('healthy');
      expect(result.components.length).toBe(1);
      expect(result.components[0].name).toBe('db');
    });

    it('reports unhealthy when any component is unhealthy', async () => {
      checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
      checker.register('cache', () => ({ name: 'cache', status: 'unhealthy', ready: false, message: 'down' }));
      const result = await checker.check();
      expect(result.status).toBe('unhealthy');
      expect(result.ready).toBe(false);
    });

    it('reports degraded when any component is degraded', async () => {
      checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
      checker.register('cache', () => ({ name: 'cache', status: 'degraded', ready: true }));
      const result = await checker.check();
      expect(result.status).toBe('degraded');
      expect(result.ready).toBe(true);
    });

    it('supports async check functions', async () => {
      checker.register('db', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { name: 'db', status: 'healthy', ready: true };
      });
      const result = await checker.check();
      expect(result.status).toBe('healthy');
    });

    it('catches errors in check functions', async () => {
      checker.register('db', () => { throw new Error('check failed'); });
      const result = await checker.check();
      expect(result.status).toBe('unhealthy');
      expect(result.components[0].status).toBe('unhealthy');
      expect(result.components[0].message).toContain('check failed');
    });

    it('unregister removes a component', async () => {
      checker.register('db', () => ({ name: 'db', status: 'unhealthy', ready: false }));
      checker.unregister('db');
      const result = await checker.check();
      expect(result.components).toEqual([]);
      expect(result.status).toBe('healthy');
    });
  });

  describe('liveness()', () => {
    it('returns true when healthy', async () => {
      checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
      expect(await checker.liveness()).toBe(true);
    });

    it('returns false when unhealthy', async () => {
      checker.register('db', () => ({ name: 'db', status: 'unhealthy', ready: false }));
      expect(await checker.liveness()).toBe(false);
    });
  });

  describe('readiness()', () => {
    it('returns true when all components ready', async () => {
      checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
      expect(await checker.readiness()).toBe(true);
    });

    it('returns false when any component not ready', async () => {
      checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
      checker.register('cache', () => ({ name: 'cache', status: 'healthy', ready: false }));
      expect(await checker.readiness()).toBe(false);
    });

    it('returns false when draining', async () => {
      checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
      checker.startDraining();
      expect(await checker.readiness()).toBe(false);
    });
  });

  describe('draining', () => {
    it('starts draining', () => {
      checker.startDraining();
      expect(checker.isDraining).toBe(true);
    });

    it('stops draining', () => {
      checker.startDraining();
      checker.stopDraining();
      expect(checker.isDraining).toBe(false);
    });

    it('check result includes draining flag', async () => {
      checker.startDraining();
      const result = await checker.check();
      expect(result.draining).toBe(true);
    });
  });

  describe('uptime and timestamp', () => {
    it('includes uptime in result', async () => {
      const result = await checker.check();
      expect(result.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('includes timestamp in result', async () => {
      const result = await checker.check();
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });
});
