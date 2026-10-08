import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ host: '0.0.0.0', port: 3001, logLevel: 'info' });
  });

  it('reads values from the environment', () => {
    expect(loadConfig({ HOST: '127.0.0.1', PORT: '4000', LOG_LEVEL: 'debug' })).toEqual({
      host: '127.0.0.1',
      port: 4000,
      logLevel: 'debug',
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
