describe('Redis E2E runner', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
    jest.resetModules();
  });

  it('sets a local Redis default when the value is missing', () => {
    delete process.env.REDIS_URL;
    const { applyDefaultEnv, DEFAULT_REDIS_URL } = require('../../scripts/test-redis-e2e');

    expect(applyDefaultEnv(process.env).REDIS_URL).toBe(DEFAULT_REDIS_URL);
  });

  it('preserves an explicitly supplied Redis URL', () => {
    process.env.REDIS_URL = 'redis://example.test:6379';
    const { applyDefaultEnv } = require('../../scripts/test-redis-e2e');

    expect(applyDefaultEnv(process.env).REDIS_URL)
      .toBe('redis://example.test:6379');
  });
});
