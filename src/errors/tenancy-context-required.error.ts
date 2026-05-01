import { TenantContextMissingError } from './tenant-context-missing.error';

export class TenancyContextRequiredError extends TenantContextMissingError {
  public override name = 'TenancyContextRequiredError';

  constructor(
    public readonly model: string,
    public readonly operation: string,
  ) {
    super(
      `Tenancy context is required but not set. ` +
      `Model: ${model}, Operation: ${operation}. ` +
      `Use withoutTenant() to explicitly bypass, or add '${model}' to sharedModels.`,
    );
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      model: this.model,
      operation: this.operation,
    };
  }
}
