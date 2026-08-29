/**
 * Validates an extracted tenant identifier before it enters tenant context.
 *
 * Returning `false` rejects the inbound request or message. Throwing or
 * returning a rejected promise propagates the original error.
 */
export type TenantIdValidator = (
  tenantId: string,
) => boolean | Promise<boolean>;
