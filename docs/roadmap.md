# @nestarc/tenancy Roadmap

> v0.6.0 구현 완료 (2026-04-02). 이 문서는 다음 단계를 정리합니다.

---

## Phase 2: 실전 검증 + 차별화 (v0.2.0) ✅ 완료

**목표**: "직접 구현해도 되지 않나?"에 대한 답을 만든다.

### 2-1. 벤치마크 공개 ✅

README에 PostgreSQL 16 + Prisma 6 기반 벤치마크 결과 공개 완료.

### 2-2. 다중 추출 전략 ✅

| 추출기 | 상태 | 사용 사례 |
|--------|------|----------|
| `HeaderTenantExtractor` | ✅ v0.1.0 | API 서버 |
| `SubdomainTenantExtractor` | ✅ v0.2.0 | SaaS (tenant1.app.com) |
| `JwtClaimTenantExtractor` | ✅ v0.2.0 | 인증 토큰 기반 |
| `PathTenantExtractor` | ✅ v0.2.0 | /api/tenants/:id/... |
| `CompositeTenantExtractor` | ✅ v0.2.0 | 여러 전략 폴백 체인 |

### 2-3. Tenant Lifecycle Hooks ✅

- `onTenantResolved(tenantId, req)` — AsyncLocalStorage 컨텍스트 내에서 실행
- `onTenantNotFound(req)` — `void` 반환 시 관찰용, `'skip'` 반환 시 `next()` 차단, throw로 에러 처리

### 2-4. Prisma 확장 고도화 ✅

- **autoInjectTenantId**: `create`, `createMany`, `createManyAndReturn`, `upsert`에 자동 주입
- **sharedModels**: 지정된 모델은 RLS + 주입 모두 건너뜀
- **tenantIdField**: 커스텀 컬럼명 지원

#### 알려진 제약

- Interactive transaction 내에서는 `set_config`가 별도 커넥션에서 실행됨 (JSDoc 문서화 완료)
- `@BypassTenancy()` Prisma 레벨 지원은 v0.3.0으로 이월

---

## Phase 3: 생태계 확장 (v0.3.0) ✅ 완료

### 3-0. v0.2.0에서 이월된 항목 ✅

- **`withoutTenant()` 프로그래밍 방식 bypass**: 백그라운드 작업, 어드민 대시보드, 크로스 테넌트 쿼리용 ✅
- **Subdomain ccTLD 대응**: `psl` 라이브러리로 정확한 서브도메인 추출 (`.co.uk` 등 multi-part TLD) ✅
- **`tenancyTransaction()` helper**: Interactive transaction 내 RLS 올바른 동작 보장 ✅
- **`experimentalTransactionSupport`**: Prisma 내부 API를 통한 투명한 interactive transaction 지원 (opt-in) ✅

### 3-1. CLI 도구 ✅

```bash
npx @nestarc/tenancy init
# → tenancy-setup.sql 생성 (RLS 정책 + 롤 + grants)
# → tenancy.module-setup.ts 생성 (TenancyModule 등록 코드)
```

**도입 비용을 0에 가깝게** 만든다.

### 3-2. 다중 DB 전략

| 전략 | 격리 수준 | 복잡도 | 사용 사례 |
|------|----------|--------|----------|
| RLS (현재) | 행 수준 | 낮음 | 대부분의 SaaS |
| Schema-per-tenant | 스키마 수준 | 중간 | 규제 산업 |
| Database-per-tenant | DB 수준 | 높음 | 엔터프라이즈 |

```typescript
TenancyModule.forRoot({
  strategy: 'rls',        // 기본값
  // strategy: 'schema',  // 스키마 분리
  // strategy: 'database', // DB 분리
})
```

### 3-3. 프레임워크 확장

- **Drizzle ORM 어댑터**: `createDrizzleTenancyExtension()`
- **TypeORM 어댑터**: subscriber 기반 `SET LOCAL`
- **MikroORM 어댑터**: filter 기반

Prisma 전용이라는 한계를 벗어나면 사용자 풀이 넓어진다.

### 3-4. Observability

- **OpenTelemetry span**: tenant_id를 span attribute에 자동 추가
- **로그 컨텍스트**: Pino/Winston에 tenant_id 자동 주입
- **메트릭**: tenant별 쿼리 수, 지연 시간

---

## Phase 3.5: 프로덕션 신뢰 기반 (v0.4.0) ✅ 완료

### 3.5-1. Fail-Closed 모드 ✅

- `failClosed: true` 옵션 — 테넌트 컨텍스트 없으면 쿼리 차단
- `TenancyContextRequiredError` — model/operation 정보 포함
- `withoutTenant()` 의도적 바이패스와 구분 (`bypassed` 플래그)

### 3.5-2. 테스팅 유틸리티 ✅

- `TestTenancyModule.register()` — 미들웨어/가드 없는 테스트 모듈
- `withTenant(tenantId, callback)` — 비동기 테넌트 컨텍스트 헬퍼
- `expectTenantIsolation()` — E2E 격리 검증 assertion
- `@nestarc/tenancy/testing` 서브패스 export

### 3.5-3. 이벤트 시스템 ✅

- `@nestjs/event-emitter` optional 통합
- 4개 이벤트: `tenant.resolved`, `tenant.not_found`, `tenant.validation_failed`, `tenant.context_bypassed`
- `TenancyEventService` — EventEmitter2 미설치 시 graceful degradation

---

## Phase 4: 마이크로서비스 기반 (v0.5.0) ✅ 완료

### 4-0. 에러 타입 통일 (Breaking Change) ✅

- `TenantContextMissingError` 기본 에러 클래스 추가
- `TenancyContextRequiredError`가 이를 상속 → `instanceof` 통합 처리 가능
- `getCurrentTenantOrThrow()` → `TenantContextMissingError` throw

### 4-1. HTTP 테넌트 전파 ✅

- `propagateTenantHeaders()` — 현재 테넌트를 HTTP 헤더로 반환하는 헬퍼 함수
- `HttpTenantPropagator` — DI 기반 HTTP 전파 구현체
- `TenantPropagator` — 전파 인터페이스 (v0.6.0 확장점)
- 외부 의존성 제로 — fetch, axios, got, undici 모두 호환

---

## Phase 4.5: 비동기 전파 (v0.6.0) ✅ 완료

### 4.5-1. 메시지 큐 전파 ✅

- **Bull Queue**: `BullTenantPropagator` — Job data에 테넌트 컨텍스트 자동 포함 ✅
- **Kafka**: `KafkaTenantPropagator` — 메시지 헤더에 테넌트 ID 전파 (string/Buffer 지원) ✅
- **gRPC**: `GrpcTenantPropagator` — metadata에 테넌트 ID 전파 ✅
- **`TenantContextCarrier<T>`** 인터페이스 — OpenTelemetry inject/extract 패턴 ✅

### 4.5-2. 전파 자동화 ✅

- `TenantContextInterceptor` — 마이크로서비스 인바운드 자동 복원 (Kafka, Bull, gRPC) ✅
- 명시적 `transport` 옵션으로 duck-typing 오탐 방지 ✅
- HTTP는 skip (TenantMiddleware가 담당) ✅

### 4.5-3. 안정화 및 CLI 강화 ✅

- `interactiveTransactionSupport` — experimental에서 stable로 승격 ✅
- CLI `check` — FORCE/POLICY/key 포함 deep validation ✅
- CLI `--dry-run` — 파일 미생성 미리보기 ✅
- `@@schema` 다중 스키마 — schema-qualified SQL 생성 ✅

---

## Phase 4.7: 안정화 + 프레임워크 중립 (v0.9.0) ✅ 완료

### 4.7-1. Express 타입 분리 ✅

- `TenancyRequest` / `TenancyResponse` 프레임워크-중립 인터페이스 도입
- `@types/express` peerDependencies에서 제거
- 퍼블릭 API (TenantExtractor, TenancyModuleOptions, 이벤트 타입) Express 의존 제거
- Fastify, raw Node.js HTTP 호환

### 4.7-2. 문서 정비 ✅

- README 호환성 주장 명확화 (E2E vs unit-tested)
- 커스텀 추출기 예제 TenancyRequest 사용
- SECURITY.md 지원 버전 최신화

---

## Phase 5: 프로덕션 신뢰 (v1.0.0)

### 5-1. 보안 강화

- 커넥션 풀 격리 검증 (PgBouncer, Prisma Data Proxy 호환)
- tenant_id 위조 방지 (JWT claim과 헤더 교차 검증)
- 감사 로그 (누가, 어떤 tenant에, 언제 접근했는지)

### 5-2. 운영 도구

- Health check endpoint (`/tenancy/health`)
- Tenant 목록 조회 API (관리자용)
- Migration helper (기존 단일 테넌트 → 멀티 테넌트 전환)

### 5-3. 문서 + 커뮤니티

- 공식 문서 사이트 (예제 중심)
- 프로덕션 사례 1~2개 확보
- NestJS 공식 레시피 기여 시도

---

## 우선순위 요약

```
✅ v0.1.0 (완료)    코어 모듈 + 벤치마크 공개
✅ v0.2.0 (완료)    다중 추출 전략 + Lifecycle Hooks + Prisma 고도화
✅ v0.3.0 (완료)    withoutTenant() + tenancyTransaction() + ccTLD + CLI
✅ v0.4.0 (완료)    Fail-Closed + Testing Utilities + Event System
✅ v0.5.0 (완료)    에러 통일 + HTTP 테넌트 전파
✅ v0.6.0 (완료)    비동기 전파 (Kafka, gRPC, Bull)
✅ v0.7.0 (완료)    위조 방지 + OpenTelemetry
✅ v0.8.0 (완료)    빌드 안정화 + 회귀 테스트
✅ v0.9.0 (완료)    Express 타입 분리 + 프레임워크 중립
→ v1.0.0           보안 강화 + 운영 도구 + 문서 사이트 + 다중 DB + ORM 어댑터
```

**핵심 원칙**: 직접 구현하면 30분, 하지만 테스트 + 엣지 케이스 + 문서까지 하면 3일 걸리는 것들을 라이브러리가 해결해준다.
