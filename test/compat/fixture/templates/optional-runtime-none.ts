function optionalCacheHandler(): void {}

export function loadOptionalRuntime() {
  return {
    cacheHandler: optionalCacheHandler,
    cacheInterceptorToken: undefined,
    cacheToken: undefined,
    eventEmitterToken: undefined,
    imports: [],
    providers: [],
  };
}
