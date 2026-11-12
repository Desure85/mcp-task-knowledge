import { describe, expect, it } from 'vitest';
import { parseUiArgs, startupHint, uiUrl } from '../src/cli/ui.js';

describe('DX-26d ui CLI', () => {
  it('parses port/host/no-open and defaults', () => {
    expect(parseUiArgs([], { MCP_PORT: '4123' })).toMatchObject({ port: 4123, host: '127.0.0.1', open: true });
    expect(parseUiArgs(['--port', '4999', '--host', '0.0.0.0', '--no-open'], {})).toMatchObject({
      port: 4999,
      host: '0.0.0.0',
      open: false,
    });
  });

  it('rejects an invalid port and shows help', () => {
    expect(parseUiArgs(['--port', '0'], {})).toContain('1..65535');
    expect(parseUiArgs(['--help'], {})).toMatchObject({ help: true });
  });

  it('maps wildcard binds to a browser-safe URL', () => {
    expect(uiUrl('0.0.0.0', 3001)).toBe('http://127.0.0.1:3001/');
    expect(uiUrl('localhost', 3002)).toBe('http://localhost:3002/');
  });

  it('turns the common startup failures into hints', () => {
    expect(startupHint({ code: 'EADDRINUSE' })).toContain('--port');
    expect(startupHint(new Error('DATA_DIR must be set'))).toContain('DATA_DIR');
    expect(startupHint(new Error('something else'))).toBeNull();
  });
});
