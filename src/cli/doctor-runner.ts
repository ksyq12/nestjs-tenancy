import {
  doctorChecksResult,
  doctorErrorResult,
  redactDoctorError,
  toDoctorTarget,
  validateDoctorOptions,
} from './doctor-contract';
import type {
  DoctorCheck,
  DoctorClient,
  DoctorDependencies,
  DoctorError,
  DoctorOptions,
  DoctorResult,
} from './doctor-contract';
import { auditDoctorDatabase } from './doctor-catalog';

class DoctorRuntimeError extends Error {
  constructor(
    readonly code: DoctorError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'DoctorRuntimeError';
  }
}

/**
 * Audit a live PostgreSQL database. This function never logs and never includes
 * the connection URL in its structured result.
 */
export async function runDoctor(
  options: DoctorOptions,
  dependencies: DoctorDependencies = {},
): Promise<DoctorResult> {
  const validation = validateDoctorOptions(options);
  if (typeof validation === 'string') {
    return doctorErrorResult('INVALID_OPTIONS', validation);
  }

  const target = toDoctorTarget(validation);
  const checks: DoctorCheck[] = [];
  let client: DoctorClient | undefined;
  let result: DoctorResult;

  try {
    try {
      client = (dependencies.clientFactory ?? defaultClientFactory)(validation.url);
    } catch (error) {
      const runtimeError = asRuntimeError(error, 'DRIVER_UNAVAILABLE');
      return doctorErrorResult(
        runtimeError.code,
        redactDoctorError(runtimeError.message, validation.url),
        target,
      );
    }

    try {
      await client.connect();
    } catch (error) {
      throw new DoctorRuntimeError(
        'CONNECTION_FAILED',
        `Could not connect to PostgreSQL: ${errorMessage(error)}`,
      );
    }

    try {
      await auditDoctorDatabase(client, validation, checks);
      result = doctorChecksResult(target, checks);
    } catch (error) {
      const runtimeError = asRuntimeError(error, 'QUERY_FAILED');
      result = doctorErrorResult(
        runtimeError.code,
        redactDoctorError(runtimeError.message, validation.url),
        target,
        checks,
      );
    }
  } catch (error) {
    const runtimeError = asRuntimeError(error, 'QUERY_FAILED');
    result = doctorErrorResult(
      runtimeError.code,
      redactDoctorError(runtimeError.message, validation.url),
      target,
      checks,
    );
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // The audit result is already complete. Never replace it with a close error.
      }
    }
  }

  return result;
}

function defaultClientFactory(url: string): DoctorClient {
  try {
    const pg = require('pg') as {
      Client: new (options: {
        connectionString: string;
        application_name: string;
        connectionTimeoutMillis: number;
      }) => DoctorClient;
    };
    return new pg.Client({
      connectionString: url,
      application_name: '@nestarc/tenancy doctor',
      connectionTimeoutMillis: 10_000,
    });
  } catch (error) {
    throw new DoctorRuntimeError(
      'DRIVER_UNAVAILABLE',
      `The "pg" package is required for the doctor command: ${errorMessage(error)}`,
    );
  }
}

function asRuntimeError(
  error: unknown,
  fallbackCode: DoctorError['code'],
): DoctorRuntimeError {
  return error instanceof DoctorRuntimeError
    ? error
    : new DoctorRuntimeError(fallbackCode, errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
