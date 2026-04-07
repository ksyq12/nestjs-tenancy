# @nestarc/tenancy 전체 코드 리뷰 보고서

> 리뷰일: 2026-04-07 | 버전: v0.9.0 + 로컬 커밋 3개 (v1.0 준비)

## 보안 검증 통과 항목

| 항목 | 결과 | 근거 |
|------|------|------|
| SQL 인젝션 (`set_config()`) | **안전** | tagged template 바인드 파라미터 사용, 문자열 보간 없음 |
| AsyncLocalStorage 컨텍스트 누수 | **안전** | `run()`이 요청별 격리 컨텍스트 생성, 동시 요청 간 올바른 격리 |
| JWT 추출기 서명 미검증 | **적절** | JSDoc에 명확한 경고, README에 미들웨어 순서 가이드 |
| `withoutTenant()` 바이패스 | **안전** | discriminated union `TenantStore`로 정상 컨텍스트와 혼동 불가 |
| `failClosed` 모드 | **안전** | bypassed/sharedModels/일반 모든 케이스 올바르게 처리 |
| 트랜잭션 스코프 격리 | **안전** | `set_config(key, value, TRUE)` = `SET LOCAL`, 커넥션 풀 누수 없음 |

---

## CRITICAL (3건)

### 1. `TenancyContext.run()` 동기 시그니처로 async 콜백의 Promise 무시 가능

**신뢰도:** 95% | **파일:** `src/services/tenancy-context.ts:12`

```typescript
run<T>(tenantId: string, callback: () => T): T {
  return TenancyContext.storage.run({ tenantId, bypassed: false }, callback);
}
```

**문제:** async 콜백 전달 시 `T`가 `Promise<void>`로 추론되어, `await` 없이 호출해도 TypeScript 에러 없음. 미들웨어에서는 `await`로 정상 동작하지만, 다른 소비자가 `await` 없이 호출하면 사일런트 버그.

**권장:** async 오버로드 추가
```typescript
run<T>(tenantId: string, callback: () => Promise<T>): Promise<T>;
run<T>(tenantId: string, callback: () => T): T;
run<T>(tenantId: string, callback: () => T | Promise<T>): T | Promise<T> {
  return TenancyContext.storage.run({ tenantId, bypassed: false }, callback);
}
```

---

### 2. `TenantContextInterceptor` Observable teardown에서 `innerSub` 미초기화 참조

**신뢰도:** 92% | **파일:** `src/propagation/tenant-context.interceptor.ts:80-90`

```typescript
return new Observable((subscriber) => {
  let innerSub: Subscription;
  try {
    this.context.run(tenantId, () => {
      innerSub = next.handle().subscribe(subscriber);
    });
  } catch (err) {
    subscriber.error(err);
  }
  return () => innerSub?.unsubscribe();
});
```

**문제:** `context.run()` 내부에서 `innerSub` 할당 전 에러 시 teardown에서 `undefined` 참조. `?.`로 크래시는 방지되나, 불필요한 복잡성.

**권장:** Observable 패턴 단순화
```typescript
return new Observable((subscriber) => {
  const sub = this.context.run(tenantId, () => next.handle()).subscribe(subscriber);
  return () => sub.unsubscribe();
});
```

---

### 3. `onTenantResolved` 훅 throw 시 에러 전파 문서 부재

**신뢰도:** 88% | **파일:** `src/middleware/tenant.middleware.ts:95-105`

**문제:** `onTenantResolved` 시그니처가 `void | Promise<void>`로 에러 계약이 없음. 훅에서 throw하면 NestJS가 500 에러로 처리하지만, 사용자가 이를 인지하지 못할 수 있음.

**권장:** JSDoc에 에러 전파 동작 명시, 또는 try/catch로 래핑 후 커스텀 에러 핸들링 옵션 제공.

---

## IMPORTANT (5건)

### 4. ITX 지원: `__internalParams` 없으면 batch로 사일런트 폴백

**신뢰도:** 85% | **파일:** `src/prisma/prisma-tenancy.extension.ts:150-157`

```typescript
if (itxSupport) {
  const txInfo = rest?.__internalParams?.transaction;
  if (txInfo?.kind === 'itx') {
    const itxClient = baseClient._createItxClient(txInfo);
    await itxClient.$executeRaw`SELECT set_config(...)`;
    return query(args);
  }
}
// 여기로 fall-through → batch $transaction
```

**문제:** `interactiveTransactionSupport: true`인데 `__internalParams`가 없는 Prisma 버전에서는 ITX 내부에서 batch 트랜잭션으로 사일런트 폴백. 생성 시점 검증은 `_createItxClient` 존재만 확인하고, `__internalParams` 구조는 검증하지 않음.

**권장:** ITX 감지 실패 시 경고 로그 추가, 또는 생성 시점에 `__internalParams` 존재도 검증.

---

### 5. Cross-check: JWT 없으면 검증 전체 skip — 공격자 우회 가능

**신뢰도:** 82% | **파일:** `src/middleware/tenant.middleware.ts:78-93`

```typescript
if (this.crossChecker) {
  const crossCheckId = await this.crossChecker.extract(req);
  if (crossCheckId && crossCheckId !== tenantId) {
    // reject or log
  }
}
```

**문제:** cross-check 추출기가 `null` 반환 시 (JWT 없는 요청) 검증이 완전히 skip됨. 이는 의도된 설계이지만, 공격자가 JWT를 보내지 않으면 헤더 위조를 통해 다른 테넌트 접근 가능.

**권장:** `crossCheck` 옵션에 `required?: boolean` 추가 — `true`이면 cross-check 추출기가 `null` 반환 시 요청 거부.

---

### 6. `propagateTenantHeaders()` 호출마다 불필요한 인스턴스 생성

**신뢰도:** 80% | **파일:** `src/propagation/propagate-tenant-headers.ts:37`

```typescript
export function propagateTenantHeaders(...) {
  const context = new TenancyContext();  // 매 호출마다 생성
  const tenantId = context.getTenantId();
  ...
}
```

**문제:** `AsyncLocalStorage`가 static이라 기능상 문제없으나, 불필요한 할당. `current-tenant.decorator.ts`는 모듈 레벨 싱글턴 패턴 사용.

**권장:** 모듈 레벨 싱글턴으로 변경
```typescript
const _ctx = new TenancyContext();
export function propagateTenantHeaders(...) {
  const tenantId = _ctx.getTenantId();
  ...
}
```

---

### 7. `@BypassTenancy`는 가드만 skip — 테넌트 컨텍스트는 유지됨

**신뢰도:** 82% | **파일:** `src/guards/tenancy.guard.ts:26-33`

**문제:** `@BypassTenancy()` 적용 라우트에서도 미들웨어가 이미 설정한 테넌트 컨텍스트가 유지됨. 헤더에 tenant ID가 있으면 `getCurrentTenant()`가 값을 반환하고, Prisma 쿼리가 RLS 필터링됨.

**의미:** "바이패스"가 "가드 통과"만 의미하고 "컨텍스트 해제"가 아님. 공개 엔드포인트에 `@BypassTenancy`를 적용하면서 `getCurrentTenant()`가 `null`일 것으로 기대하는 개발자에게 혼란.

**권장:** README에 동작을 명확히 문서화. 또는 데코레이터 이름을 `@AllowMissingTenant()`로 명확화 고려.

---

### 8. `onTenantNotFound`가 `'skip'` 반환 + 응답 미전송 시 요청 무한 대기

**신뢰도:** 80% | **파일:** `src/middleware/tenant.middleware.ts:62-68`

**문제:** `onTenantNotFound`가 `'skip'`을 반환하면 `next()`를 호출하지 않음. 사용자가 응답도 보내지 않으면 HTTP 요청이 무한 대기.

**권장:** JSDoc 경고 강화 — `'skip'` 반환 시 반드시 응답을 보내야 함을 명시.

---

## CODE QUALITY (3건)

### 9. Prisma 스키마 파서 regex가 중괄호 포함 기본값에서 실패

**신뢰도:** 80% | **파일:** `src/cli/prisma-schema-parser.ts:13`

```typescript
const modelRegex = /^model\s+(\w+)\s*\{([^}]*)}/gm;
```

**문제:** `[^}]*`가 `@default("{}")` 같은 중괄호 포함 기본값에서 조기 종료. 해당 모델의 `@@map`이나 `@@schema` 디렉티브를 놓침.

**권장:** 줄 단위 파서로 변경하거나, 중괄호 밸런싱 로직 추가.

---

### 10. `SubdomainTenantExtractor`의 `pslModule!` 비안전 non-null assertion

**신뢰도:** 80% | **파일:** `src/extractors/subdomain.extractor.ts:15`

```typescript
pslModule = require('psl');
return pslModule!;  // require가 falsy 반환하면 unsafe
```

**권장:** `return pslModule!` → `return pslModule as typeof import('psl')` 또는 할당 후 null 체크.

---

### 11. `propagateTenantHeaders`는 모듈 레벨 싱글턴으로 변경 가능

**신뢰도:** 80% | **파일:** `src/propagation/propagate-tenant-headers.ts`

이슈 #6과 동일. `current-tenant.decorator.ts`에서 이미 사용 중인 모듈 레벨 싱글턴 패턴을 적용.

---

## 이슈 파일별 요약

| 파일 | 이슈 | 심각도 |
|------|------|--------|
| `services/tenancy-context.ts` | #1 — async 시그니처 | CRITICAL |
| `propagation/tenant-context.interceptor.ts` | #2 — Observable teardown | CRITICAL |
| `middleware/tenant.middleware.ts` | #3, #5, #8 — 에러/바이패스/skip | CRITICAL + IMPORTANT |
| `prisma/prisma-tenancy.extension.ts` | #4 — ITX 사일런트 폴백 | IMPORTANT |
| `propagation/propagate-tenant-headers.ts` | #6 — 불필요한 할당 | IMPORTANT |
| `guards/tenancy.guard.ts` | #7 — BypassTenancy 의미 혼동 | IMPORTANT |
| `cli/prisma-schema-parser.ts` | #9 — regex 실패 | CODE QUALITY |
| `extractors/subdomain.extractor.ts` | #10 — non-null assertion | CODE QUALITY |
