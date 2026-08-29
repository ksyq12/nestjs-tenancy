import type { TenancyModuleOptions } from './interfaces/tenancy-module-options.interface';
import { assertValidPostgresSettingKey } from './postgres-safety';
import { DEFAULT_DB_SETTING_KEY } from './tenancy.constants';

export interface TenancyRuntimeConfig {
  readonly dbSettingKey: string;
}

export function normalizeDbSettingKey(value?: string): string {
  const dbSettingKey = value === undefined
    ? DEFAULT_DB_SETTING_KEY
    : value;
  assertValidPostgresSettingKey(dbSettingKey);
  return dbSettingKey;
}

export function createTenancyRuntimeConfig(
  options?: Pick<TenancyModuleOptions, 'dbSettingKey'>,
): TenancyRuntimeConfig {
  return Object.freeze({
    dbSettingKey: normalizeDbSettingKey(options?.dbSettingKey),
  });
}

export function resolveRuntimeDbSettingKey(
  runtimeConfig: TenancyRuntimeConfig | undefined,
  explicitDbSettingKey?: string,
): string {
  const explicit = explicitDbSettingKey === undefined
    ? undefined
    : normalizeDbSettingKey(explicitDbSettingKey);

  if (!runtimeConfig) {
    return explicit ?? DEFAULT_DB_SETTING_KEY;
  }

  const canonical = normalizeDbSettingKey(runtimeConfig.dbSettingKey);
  if (explicit !== undefined && explicit !== canonical) {
    throw new Error(
      '[@nestarc/tenancy] dbSettingKey mismatch: ' +
      `canonical value ${JSON.stringify(canonical)} does not match explicit value ${JSON.stringify(explicit)}. ` +
      'Remove the explicit dbSettingKey or make it match TenancyModule configuration.',
    );
  }

  return canonical;
}
