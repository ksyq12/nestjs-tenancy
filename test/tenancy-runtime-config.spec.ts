import {
  createTenancyRuntimeConfig,
  normalizeDbSettingKey,
  resolveRuntimeDbSettingKey,
} from '../src/tenancy-runtime-config';

describe('tenancy runtime config', () => {
  it('normalizes an omitted key to the shared default', () => {
    expect(normalizeDbSettingKey()).toBe('app.current_tenant');
  });

  it('preserves a valid custom key without case or whitespace rewriting', () => {
    expect(normalizeDbSettingKey('Custom.Tenant_1')).toBe('Custom.Tenant_1');
  });

  it('rejects a key outside the shared PostgreSQL custom-setting grammar', () => {
    expect(() => normalizeDbSettingKey('invalid-key')).toThrow(
      'Invalid database setting key',
    );
    expect(() =>
      normalizeDbSettingKey(null as unknown as string),
    ).toThrow('Invalid database setting key');
  });

  it('creates an immutable canonical snapshot', () => {
    const options = { dbSettingKey: 'custom.tenant' };
    const config = createTenancyRuntimeConfig(options);
    options.dbSettingKey = 'other.tenant';

    expect(config).toEqual({ dbSettingKey: 'custom.tenant' });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('keeps standalone explicit custom keys backward compatible', () => {
    expect(resolveRuntimeDbSettingKey(undefined)).toBe('app.current_tenant');
    expect(resolveRuntimeDbSettingKey(undefined, 'custom.tenant')).toBe(
      'custom.tenant',
    );
  });

  it('inherits or confirms a configured canonical key', () => {
    const config = createTenancyRuntimeConfig({
      dbSettingKey: 'custom.tenant',
    });

    expect(resolveRuntimeDbSettingKey(config)).toBe('custom.tenant');
    expect(resolveRuntimeDbSettingKey(config, 'custom.tenant')).toBe(
      'custom.tenant',
    );
  });

  it('rejects an explicit key that differs from the canonical key', () => {
    const config = createTenancyRuntimeConfig({
      dbSettingKey: 'custom.tenant',
    });

    expect(() =>
      resolveRuntimeDbSettingKey(config, 'other.tenant'),
    ).toThrow(/dbSettingKey mismatch.*custom\.tenant.*other\.tenant/i);
  });
});
