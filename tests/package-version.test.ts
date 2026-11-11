import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPackageVersion } from '../src/utils/package-version.js';

const previous = process.env.npm_package_version;

afterEach(() => {
  if (previous === undefined) delete process.env.npm_package_version;
  else process.env.npm_package_version = previous;
});

describe('TR-24 shared package version', () => {
  it('prefers npm_package_version when set', async () => {
    process.env.npm_package_version = '9.8.7-test';
    await expect(getPackageVersion()).resolves.toBe('9.8.7-test');
  });

  it('falls back to the repository package.json', async () => {
    delete process.env.npm_package_version;
    const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    await expect(getPackageVersion()).resolves.toBe(pkg.version);
  });
});
