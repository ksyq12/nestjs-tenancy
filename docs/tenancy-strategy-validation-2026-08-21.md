# `@nestarc/tenancy` 전략·기능 검증 및 세션 인수인계

- 작성일: 2026-08-21 (Asia/Seoul)
- 검증 기준 커밋: `2fe5288` (`Release version 0.14.0`)
- 검증 패키지 버전: `0.14.0`
- P0 구현 완료: 2026-08-21 (`live DB doctor` + 실제 owner/FORCE 및 active RLS E2E)
- 목적: 다음 Codex/개발 세션에서 조사 맥락을 다시 수집하지 않고 구현 우선순위를 바로 결정할 수 있도록 근거와 결론을 보존한다.

## 1. 검증 대상

다음 전략 제안이 현재 패키지의 실제 상태와 일치하는지 검증했다.

1. `tenancy`를 Nestarc의 대표 패키지로 집중한다.
2. Prisma 내부 동작에 덜 의존하는 안정적인 interactive transaction API를 우선한다.
3. PgBouncer/connection pool 환경 E2E 매트릭스를 만든다.
4. `api-keys → tenancy → rbac → jobs/outbox/webhook` 통합 테스트 키트를 만든다.
5. Redis·검색·queue까지 tenant context 누락을 진단한다.
6. 운영 DB의 RLS policy drift와 fail-closed 상태를 검사하는 `doctor` 명령을 만든다.
7. TypeORM·Drizzle보다 Prisma/PostgreSQL 경로에 집중한다.

## 2. 요약 결론

제안한 기술 우선순위는 대체로 타당하다. 다만 아래처럼 분류해야 정확하다.

| 제안 | 최종 판정 | 정확한 해석 |
| --- | --- | --- |
| 안정적인 interactive transaction API | 이미 구현됨 + 잔여 호환성 위험 | public API 기반 `tenancyTransaction()`은 이미 존재한다. 실제 문제는 Prisma 내부 API를 사용하는 선택적 transparent mode와 부족한 실DB 호환성 매트릭스다. |
| PgBouncer/pool E2E | 실제 보증 공백 | direct PostgreSQL E2E만 있고 PgBouncer, pool mode, 강제 connection 재사용 검증이 없다. 현재 tenant leak이 재현된 것은 아니다. |
| 패키지 간 통합 테스트 키트 | 실제 신규 기능 공백 | 현재 `./testing`은 단일 패키지용 helper뿐이다. 공개 Nestarc 저장소에서도 전체 체인의 자동화 테스트를 찾지 못했다. |
| Redis·검색·queue 누락 진단 | 부분 구현 + 실제 진단 공백 | transport propagator와 tenant-aware cache는 존재한다. 하지만 non-HTTP 누락은 대부분 silent/pass-through이며 실 Redis/search E2E가 없다. |
| 운영 DB `doctor` | P0 구현 완료 + 후속 범위 분리 | live DB catalog/role/policy와 opt-in active fail-closed probe를 구현했다. manifest batch와 PgBouncer 재사용 검증은 후속이다. |
| TypeORM·Drizzle 보류 | 합리적인 전략 결정 | 패키지는 이미 Prisma/PostgreSQL 전용이다. 현재의 문제는 ORM 확장이 아니라 로드맵의 과잉 약속과 핵심 경로의 운영 보증 부족이다. |
| 자체 수요가 가장 강하고 선점 가능 | 공개 근거 부족 및 일부 반증 | 더 많이 다운로드되는 직접 경쟁 패키지와 Prisma 공식 RLS가 존재한다. 경쟁 우위는 RLS 자체보다 NestJS 운영 통합에서 찾아야 한다. |

핵심적으로, 최초 조사는 “현재 패키지가 깨져 있다”는 결론이 아니었다. 기본 경로의 테스트는 모두 통과했고 조건부 호환성 결함, 잘못 이름 붙은 E2E 한 건, production guarantee의 공백을 확인했다. 이번 P0에서 live doctor 공백과 잘못 이름 붙은 FORCE E2E는 해소했으며, PgBouncer 및 나머지 production matrix는 아래 우선순위에 남아 있다.

## 3. 검증 방법과 실행 결과

### 3.1 조사 범위

- `src/`, `test/`, `scripts/`, CI/release workflow, Docker Compose, `README.md`, roadmap 및 기존 audit 문서를 확인했다.
- 공개 `nestarc` GitHub 조직의 테스트 코드를 검색해 cross-package integration 체인의 존재 여부를 확인했다.
- npm downloads API, 경쟁 패키지 공식 문서/GitHub, Prisma 공식 changelog를 2026-08-21 기준으로 확인했다.
- 시장 수치는 시점 의존적이므로 이 문서의 수치를 장기적인 사용자 수로 해석하면 안 된다.

### 3.2 실행 검증

검증 당시 다음 명령이 모두 통과했다.

```bash
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run build
npm run lint
npm run test:e2e
```

결과:

- unit: 40 suites, 429 tests 통과
- build: 통과
- lint: 통과
- E2E: 2 suites, 27 tests 통과
- E2E 환경: Prisma 7.9.1 + PostgreSQL 16 직접 연결
- 현재 환경에서는 transaction helper/transparent mode 장애나 tenant leak을 재현하지 못했다.
- 감사 과정에서 제품 코드는 수정하지 않았다.

### 3.3 P0 구현 후 실행 검증

이 문서의 P0인 live DB doctor와 RLS E2E 신뢰성 작업을 완료한 뒤 다음 명령을 다시 실행했다.

```bash
npm test -- --runInBand
npm run build
npm run lint
npm run test:e2e
npm pack --dry-run
npm ls pg --omit=dev
```

결과:

- unit/coverage: 42 suites, 515 tests 통과
- coverage: 전체 statements 99.21%, branches 97.51%, functions 100%, lines 99.24%; `src/cli/doctor.ts` branches 98.84%
- build 및 lint: 통과
- 실DB E2E: 3 suites, 31 tests 통과
- E2E 환경: Prisma 7.9.1 + PostgreSQL 16 직접 연결
- live doctor의 catalog-only, active A/B, application-owner 위험, 예상 밖 permissive policy drift를 실제 PostgreSQL에서 검증했다.
- 실제 table owner에 `FORCE ROW LEVEL SECURITY`가 적용되는 경로와 application role의 no-context SELECT/INSERT fail-closed를 검증했다.
- 배포 산출물에 `dist/cli/doctor.js`가 포함되고, `pg`가 production dependency로 설치되는 것을 확인했다.

## 4. 상세 검증 결과

### 4.1 Interactive transaction: 새 API가 아니라 기존 API의 신뢰성 강화

#### 이미 존재하는 안전한 대표 경로

공개 `tenancyTransaction()` helper는 Prisma의 공개 `$transaction()`과 transaction client의 `$executeRaw`만 요구한다.

- 구현: [`src/prisma/tenancy-transaction.ts`](../src/prisma/tenancy-transaction.ts#L44)
- root export: [`src/index.ts`](../src/index.ts#L30)
- 권장 사용법: [`README.md`](../README.md#L214)
- 실제 PostgreSQL E2E: [`test/e2e/prisma-extension.e2e-spec.ts`](../test/e2e/prisma-extension.e2e-spec.ts#L216)
- unit tests: [`test/tenancy-transaction.spec.ts`](../test/tenancy-transaction.spec.ts#L23)

동작 순서는 다음과 같다.

1. transaction 시작 전에 현재 tenant를 fail-closed로 조회한다.
2. Prisma interactive transaction을 연다.
3. callback보다 먼저 transaction-local `set_config(..., true)`를 실행한다.
4. tenant setting이 적용된 transaction client를 사용자 callback에 넘긴다.

따라서 “Prisma 내부 API에 덜 의존하는 transaction API가 없다”는 표현은 부정확하다.

#### 실제 잔여 위험: transparent mode

`interactiveTransactionSupport: true`인 선택적 transparent mode는 다음 Prisma 내부 구조를 사용한다.

- `_createItxClient`: [`src/prisma/prisma-tenancy.extension.ts`](../src/prisma/prisma-tenancy.extension.ts#L11)
- `__internalParams.transaction`: 같은 파일 18행 이후
- runtime 감지 및 내부 client 생성: 같은 파일 171행 이후
- startup 검증: 같은 파일 114행 이후

startup에서는 `_createItxClient` 존재만 확인한다. Prisma가 `__internalParams` 또는 `transaction.kind`의 shape를 변경하면 startup 검사를 통과한 뒤 일반 batch transaction 경로로 조용히 fallback할 수 있다. 기존 repository audit도 동일 위험을 기록한다.

- 기존 감사 기록: [`docs/code-review-2026-04-07.md`](./code-review-2026-04-07.md#L85)
- metadata 부재 시 fallback을 기대하는 테스트: [`test/prisma-tenancy.extension.spec.ts`](../test/prisma-tenancy.extension.spec.ts#L772)

이는 Prisma 7.9.1에서 현재 재현되는 장애가 아니라, 내부 contract 변경 시 fail-fast하지 못하는 조건부 호환성 결함이다.

#### 남은 보증 공백

- Prisma 6 CI lane은 unit/build만 수행하며 실DB E2E를 수행하지 않는다: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml#L37).
- 실DB E2E는 기본 Prisma 7 개발 버전 한 lane뿐이다.
- helper option에는 Prisma interactive transaction의 `maxWait`가 없다.
- callback 실패 후 실제 write rollback, `set_config` 실패, `$transaction` 시작 실패의 실DB 검증이 없다.
- custom setting key, timeout, isolation level의 실DB 의미를 검증하지 않는다.
- 일부 unit test는 이름과 달리 실제 setting 값과 callback 이전 실행 순서를 assert하지 않는다.

#### 권장 결정

- `tenancyTransaction()`을 canonical/권장 경로로 명시한다.
- public helper의 Prisma 버전별 실DB 계약과 failure semantics를 강화한다.
- transparent mode는 전체 내부 contract를 fail-fast로 검사하거나 장기적으로 experimental/deprecated 경로로 낮춘다.

### 4.2 PgBouncer/connection pool E2E: 실제로 없는 production guarantee

현재 Docker/CI/release는 PostgreSQL 직접 연결만 사용한다.

- Compose 서비스는 PostgreSQL 하나: [`docker-compose.yml`](../docker-compose.yml#L1)
- E2E runner 기본 URL은 `localhost:5433` direct PostgreSQL: [`scripts/test-e2e.js`](../scripts/test-e2e.js#L12)
- CI E2E는 PostgreSQL 16 단일 lane: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml#L59)
- release도 동일 direct E2E만 사용: [`.github/workflows/release.yml`](../.github/workflows/release.yml#L23)
- roadmap 자체도 pool/PgBouncer 검증을 미완료로 둔다: [`docs/roadmap.md`](./roadmap.md#L185)

현재 raw PostgreSQL E2E는 `SET LOCAL`이 commit 뒤 사라지는지, 서로 다른 direct connection이 격리되는지를 검증한다.

- [`test/e2e/prisma-tenancy.e2e-spec.ts`](../test/e2e/prisma-tenancy.e2e-spec.ts#L69)

그러나 이는 외부 pooler의 mode, prepared statement 설정, 물리 connection 재사용을 통과하는 검증이 아니다. README는 pool leak이 없다고 설명하면서 실제 운영과 같은 PgBouncer mode 검증을 사용자에게 맡긴다.

- [`README.md`](../README.md#L973)

최소 권장 매트릭스:

- PgBouncer transaction mode의 지원 조합
- session mode의 명시적 지원/비지원 또는 negative test
- pool size 1로 물리 connection 재사용 강제
- tenant A → tenant B → no-context 순차 실행
- commit, rollback, callback error, timeout 뒤 setting 제거
- 높은 동시성에서 connection 교체와 재사용
- Prisma 6/7 및 향후 Prisma 8 지원 범위별 실제 DB lane
- helper mode와 transparent mode를 분리해 결과 기록

판정은 “현재 leak 확인”이 아니라 “leak이 없다는 production claim을 뒷받침할 매트릭스 부재”다.

### 4.3 Cross-package integration kit: ecosystem 수준 신규 기능

현재 `@nestarc/tenancy/testing`은 다음 세 API만 공개한다.

- `TestTenancyModule`
- `withTenant`
- `expectTenantIsolation`

근거:

- testing barrel: [`src/testing/index.ts`](../src/testing/index.ts#L1)
- test module providers: [`src/testing/test-tenancy.module.ts`](../src/testing/test-tenancy.module.ts#L38)
- Prisma `findMany()` 기반 isolation helper: [`src/testing/expect-tenant-isolation.ts`](../src/testing/expect-tenant-isolation.ts#L25)

현재 package dependency/peer dependency에는 다른 `@nestarc/*` 패키지가 없고, E2E도 Prisma/PostgreSQL만 다룬다.

- [`package.json`](../package.json#L71)
- [`test/e2e/jest.e2e.config.ts`](../test/e2e/jest.e2e.config.ts#L3)

2026-08-21 공개 GitHub 조직 검색에서도 다음 자동화 체인을 찾지 못했다.

```text
api-keys → tenancy → rbac → jobs/outbox/webhook
```

이는 `tenancy` runtime에 모두 의존시키는 기능보다 별도 compatibility repository 또는 fixture application으로 두는 편이 적절하다. 실제 transport와 각 패키지를 설치한 상태에서 다음을 검증해야 한다.

1. API key가 tenant identity를 결정한다.
2. tenancy context가 HTTP에서 생성된다.
3. RBAC가 동일 tenant context로 authorization한다.
4. job/outbox/webhook payload에 tenant가 전파된다.
5. consumer가 context를 복원한다.
6. tenant 누락·불일치가 fail-closed 또는 명시적 policy에 따라 처리된다.
7. 다른 tenant의 데이터와 side effect가 관찰되지 않는다.

### 4.4 Redis·검색·queue context 누락 진단: 기반은 있으나 silent semantics

이미 존재하는 기반:

- HTTP/Bull/Kafka/gRPC propagator export: [`src/index.ts`](../src/index.ts#L44)
- Bull payload inject/extract: [`src/propagation/bull-tenant-propagator.ts`](../src/propagation/bull-tenant-propagator.ts#L42)
- inbound Bull/Kafka/gRPC context 복원: [`src/propagation/tenant-context.interceptor.ts`](../src/propagation/tenant-context.interceptor.ts#L73)
- tenant-aware cache key: [`src/cache/tenant-cache.interceptor.ts`](../src/cache/tenant-cache.interceptor.ts#L38)

실제 공백:

- outbound HTTP는 context가 없으면 `{}`를 반환한다.
- Bull/Kafka/gRPC outbound는 context가 없으면 원 carrier를 반환한다.
- inbound queue/RPC는 tenant를 찾지 못해도 handler를 그대로 실행한다.
- cache는 tenant가 없으면 안전하게 caching을 끄지만 오류, event, span, counter를 만들지 않는다.
- tenancy events에 propagation/cache/search/queue 누락 event가 없다: [`src/events/tenancy-events.ts`](../src/events/tenancy-events.ts#L11).
- telemetry service는 generic attribute/span helper이며 propagator/cache와 연결되지 않는다: [`src/telemetry/tenancy-telemetry.service.ts`](../src/telemetry/tenancy-telemetry.service.ts#L43).
- Redis 전용 client/key helper/실환경 E2E가 없다.
- 검색 engine adapter와 E2E가 없다.
- 관련 기능은 수동 opt-in이며 `TenancyModule`이 자동 등록하지 않는다: [`src/tenancy.module.ts`](../src/tenancy.module.ts#L72).

HTTP는 예외적으로 비교적 fail-closed다.

- middleware의 `tenant.not_found` event: [`src/middleware/tenant.middleware.ts`](../src/middleware/tenant.middleware.ts#L68)
- guard의 tenant 누락 403: [`src/guards/tenancy.guard.ts`](../src/guards/tenancy.guard.ts#L22)

권장 기능은 단순 adapter 수 증가보다 일관된 missing-context policy다.

```text
ignore | warn | throw
```

이 policy를 propagator, queue consumer, cache, Redis/search helper에 공통 적용하고 event, OpenTelemetry span/event, metric counter에 resource/transport 정보를 기록하는 방향이 적절하다.

### 4.5 Live DB `doctor`: P0 기능 공백 해소

#### 구현 완료 상태 (2026-08-21)

신규 `doctor` 명령이 [`src/cli/doctor.ts`](../src/cli/doctor.ts)에 구현되었고 [`src/cli/index.ts`](../src/cli/index.ts)에서 비동기 cleanup을 보장하는 방식으로 dispatch된다.

현재 계약:

- 실제 application-role `DATABASE_URL`로 명시한 `schema.table` 한 개를 감사한다.
- 기본 catalog-only 모드와 명시적 `--active` behavior probe를 분리한다.
- current/session role, `SUPERUSER`, `BYPASSRLS`, owner 및 전환 가능한 위험 role을 검사한다.
- `pg_class`, `pg_attribute`, `pg_index`, `pg_policy`와 실제 schema/table grant를 검사한다.
- `ENABLE`/`FORCE`/`row_security_active`, tenant column type·NULLability·index, `TRUNCATE` 위험을 검사한다.
- 생성 SQL의 두 policy를 command, permissive mode, PUBLIC role, `USING`, `WITH CHECK`, `current_setting(..., true)`까지 exact contract로 비교하고 추가 permissive policy를 실패 처리한다.
- active 모드는 read-only transaction에서 no-context → tenant A + COMMIT → no-context → tenant B + ROLLBACK → no-context 순서로 검사한다.
- A/B fixture row가 없으면 성공이 아니라 inconclusive finding으로 처리한다.
- human-readable/JSON 출력과 exit code `0=healthy`, `1=finding/inconclusive`, `2=usage/connection/query error`를 제공한다.
- URL과 tenant probe 값은 결과에 포함하지 않으며 연결 및 statement timeout을 적용한다.

검증 근거:

- unit/CLI contract: [`test/cli/doctor.spec.ts`](../test/cli/doctor.spec.ts)
- live catalog, active probe, owner risk, 실제 permissive drift: [`test/e2e/doctor.e2e-spec.ts`](../test/e2e/doctor.e2e-spec.ts)
- runtime PostgreSQL dependency: [`package.json`](../package.json)
- 사용자 계약: [`README.md`](../README.md#cli)

현재 명령은 invocation당 한 테이블을 명시적으로 감사한다. schema/manifest 전체를 한 번에 순회하는 batch mode, extra restrictive policy drift, domain NOT NULL/identity column, partial/INCLUDE index의 더 엄격한 분류는 비차단 후속이다. PgBouncer 물리 connection 재사용 검증도 아래 별도 P0/P1 matrix 범위이며 이 doctor 완료로 보장한다고 해석하면 안 된다.

#### 구현 전 확인한 공백

구현 전 CLI는 `init`과 `check`만 제공했다.

- command dispatch: [`src/cli/index.ts`](../src/cli/index.ts#L5)
- check options: [`src/cli/check.ts`](../src/cli/check.ts#L5)

기존 `check`는 지금도 의도적으로 로컬 정적 검사 역할을 유지한다. DB URL이나 client를 받지 않고 로컬 `schema.prisma`와 `tenancy-setup.sql`을 읽어 다음 문자열 패턴을 검사한다.

- RLS `ENABLE`/`FORCE` 문구
- 예상 policy 이름
- tenant index 문구
- `current_setting` key

근거:

- 파일 읽기: [`src/cli/check.ts`](../src/cli/check.ts#L61)
- ENABLE 검사: 같은 파일 83행 이후
- FORCE 검사: 같은 파일 126행 이후
- policy 이름 검사: 같은 파일 136행 이후
- setting key 검사: 같은 파일 165행 이후

구현 전에는 다음 상태를 검증하지 못했다. 현재는 위 `doctor`가 PgBouncer 재사용 항목을 제외한 P0 범위를 담당한다.

- SQL이 운영 DB에 실제 적용되었는지
- `pg_class.relrowsecurity`, `relforcerowsecurity`
- `pg_policy`의 command, role, permissive/restrictive, `USING`, `WITH CHECK`
- 예상하지 않은 추가 permissive policy
- application role의 `SUPERUSER`, `BYPASSRLS`
- table owner로 접속하는지
- 실제 runtime role/grant
- tenant column의 type/NULLability
- no-context, tenant A/B active probe가 fail-closed인지
- PgBouncer connection 재사용 뒤 context가 남는지

초기 권고는 catalog audit와 active behavior probe를 구분하고 Nestarc의 DB setting key, application role, missing-context semantics까지 검사하는 것이었다. 이 범위는 구현되었다. `tenancyTransaction()` 경로 및 pool reuse 검증은 doctor가 과도한 보증을 주장하지 않도록 별도의 transaction/PgBouncer matrix로 남겼다.

#### 해결된 E2E 이름/fixture 불일치

기존 `should enforce FORCE ROW LEVEL SECURITY on app_user role` E2E는 fixture에 `FORCE ROW LEVEL SECURITY`가 없어 실제 owner 경로를 검증하지 못했다. 이번 P0에서 다음과 같이 교정했다.

- `users` fixture에 `ENABLE`과 `FORCE`, 표준 policy 이름을 함께 적용했다: [`test/e2e/setup.sql`](../test/e2e/setup.sql).
- 별도 `force_owner_users` fixture를 실제 `app_user` 소유로 만들었다.
- catalog에서 owner/non-superuser/non-bypass/FORCE 상태를 확인한 뒤, 실제 owner connection에서 no-context 0행과 tenant A 격리를 검증한다: [`test/e2e/prisma-tenancy.e2e-spec.ts`](../test/e2e/prisma-tenancy.e2e-spec.ts).
- application role의 fresh no-context SELECT 0행, INSERT RLS 오류, tenant A/B exact rows도 함께 검증한다.

이제 fixture에서 FORCE를 제거하면 table owner가 전체 행을 볼 수 있어 테스트가 실패한다. 기존의 잘못된 이름/fixture 불일치는 해결되었다.

### 4.6 Prisma/PostgreSQL 집중: 현재 구현과 일치

현재 패키지는 이미 Prisma/PostgreSQL 전용이다.

- package description: [`package.json`](../package.json#L2)
- required Prisma peer, TypeORM/Drizzle peer 없음: [`package.json`](../package.json#L71)
- 공개 DB API는 Prisma extension과 `tenancyTransaction()`: [`src/index.ts`](../src/index.ts#L30)
- CLI는 Prisma schema parser와 PostgreSQL RLS SQL을 사용한다.

TypeORM·Drizzle·MikroORM은 실제 구현이 아니라 roadmap/research에만 존재한다.

- adapter roadmap: [`docs/roadmap.md`](./roadmap.md#L78)
- v1 summary의 adapter 약속: [`docs/roadmap.md`](./roadmap.md#L207)

따라서 “지금 ORM 범위가 너무 넓다”는 현재 결함은 없다. 실제 문제는 Phase 완료 표기 및 v1 약속과 구현 상태의 불일치다. Prisma/PostgreSQL의 transaction, pooler, RLS 운영 검증을 먼저 보장 범위로 고정하는 것은 현재 구조와 일치한다.

## 5. 시장 및 경쟁 상황 스냅샷

### 5.1 주의사항

- 기준일: 2026-08-21 KST
- npm 구간: 완료된 최근 30일인 2026-07-22~2026-08-20
- npm 다운로드는 고유 사용자 수가 아니다. CI, bot, dependency install, mirror가 포함될 수 있다.
- GitHub star도 production adoption을 증명하지 않는다.
- 다음 세션에서 시장 판단을 사용할 경우 반드시 수치를 다시 조회한다.

### 5.2 동일 기간 npm 다운로드

| 분류 | 패키지 | 30일 다운로드 | 비고 |
| --- | --- | ---: | --- |
| 조사 대상 | [`@nestarc/tenancy`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/%40nestarc%2Ftenancy) | 369 | 현재 패키지 |
| 직접 경쟁 | [`@cerebruminc/yates`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/%40cerebruminc%2Fyates) | 7,588 | PostgreSQL RLS + Prisma 7 |
| 직접 경쟁 | [`@usebetterdev/tenant`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/%40usebetterdev%2Ftenant) | 2,203 | Prisma·Drizzle, RLS CLI/check |
| 직접 경쟁 구성품 | [`@usebetterdev/tenant-prisma`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/%40usebetterdev%2Ftenant-prisma) | 1,882 | 본체와 동시 설치 가능하므로 합산 금지 |
| DB-native RLS | [`prisma-extension-rls`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/prisma-extension-rls) | 14 | 공개 채택 미미 |
| migration tool | [`@shoito/prismarls`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/%40shoito%2Fprismarls) | 3,153 | runtime tenancy package는 아님 |
| NestJS 직접 유사 | [`@juano-morello/nest-tenant`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/%40juano-morello%2Fnest-tenant) | 13 | source repository 상태가 불명확 |
| application-layer 인접 경쟁 | [`prisma-rls`](https://api.npmjs.org/downloads/point/2026-07-22:2026-08-20/prisma-rls) | 5,957 | DB RLS가 아니라 Prisma `where` injection |

### 5.3 기능 경쟁

#### Yates

- 공식 저장소: <https://github.com/cerebruminc/yates>
- PostgreSQL RLS + Prisma 7을 직접 지원한다.
- caller-owned interactive transaction을 재사용한다.
- nested transaction과 rollback을 지원한다고 문서화한다.
- migration/runtime API를 분리한다.
- runtime 시작 시 applied manifest drift를 fail-fast로 검사한다.

#### UseBetter Tenant

- 공식 문서: <https://docs.usebetter.dev/tenant/quick-start/>
- Prisma와 Drizzle adapter를 제공한다.
- interactive transaction에서 transaction-local `set_config`를 사용한다.
- DB에 연결하는 CLI `check`가 10개 이상의 validation을 수행한다고 문서화한다.
- connection pool 안전성을 주장한다. 이는 문서상 claim이며 이 조사에서 경쟁 패키지의 E2E 품질까지 독립 검증한 것은 아니다.

#### Prisma 8

- 공식 발표: <https://www.prisma.io/changelog/2026-07-17>
- 2026-07-17 기준 Early Access다.
- schema/TypeScript의 RLS policy authoring을 제공한다.
- `@@rls`가 제거될 때까지 fail-closed인 contract를 제공한다.
- `db verify`가 policy에 명시한 role의 실제 존재 등을 검증한다.

따라서 “공식 공급자가 없고 직접 경쟁도 거의 없어 선점할 수 있다”는 전제는 더 이상 안전하지 않다.

### 5.4 수정된 시장 포지셔닝

권장 표현:

> 커뮤니티의 Prisma/PostgreSQL RLS 구현은 아직 파편화되어 있지만, Yates와 UseBetter가 transaction·policy drift·health check 영역을 이미 구현했고 Prisma 8도 RLS를 공식화하고 있다. `@nestarc/tenancy`의 차별화는 RLS 자체가 아니라 NestJS request context, queue/cache/search propagation, PgBouncer 검증, live runtime diagnostics, Nestarc cross-package compatibility를 한 운영 계약으로 묶는 데 있다.

“`tenancy`가 다른 모든 Nestarc 패키지의 차별화를 강화한다”는 내용은 타당한 전략 가설일 수 있으나, 현재 공개 adoption/retention/cross-install 데이터로는 검증되지 않았다.

## 6. 권장 구현 우선순위

### P0 — live DB doctor와 RLS E2E 신뢰성 ✅ 완료 (2026-08-21)

1. ✅ 잘못 이름 붙은 FORCE E2E를 실제 owner/FORCE fixture로 수정했다.
2. ✅ live DB catalog audit를 구현했다.
3. ✅ application role과 direct/reachable bypass 위험 검사를 구현했다.
4. ✅ no-context 및 tenant A/B active probe를 추가했다.
5. ✅ human-readable/JSON 출력과 안정적인 exit code `0/1/2`를 정의했다.

### P0/P1 — PgBouncer matrix

1. 재현 가능한 PgBouncer Compose profile을 만든다.
2. transaction mode를 최소 지원 계약으로 정한다.
3. pool size 1, tenant A → B → no-context를 필수 보안 시나리오로 둔다.
4. commit/rollback/error/timeout/동시성을 검증한다.
5. 지원 Prisma major별 실DB lane을 운영한다.

### P1 — transaction API 대표 경로 정리

1. `tenancyTransaction()`을 canonical API로 문서화한다.
2. `maxWait` 및 필요한 public transaction option 지원 여부를 결정한다.
3. 실제 rollback/failure/custom key/isolation E2E를 추가한다.
4. transparent internal mode의 fail-fast contract 또는 deprecation 방향을 결정한다.

### P1 — non-HTTP missing-context diagnostics

1. 공통 `ignore | warn | throw` policy를 설계한다.
2. event, OpenTelemetry, metric을 transport/resource별로 연결한다.
3. 실제 BullMQ/Redis E2E를 만든다.
4. search는 특정 vendor 구현보다 adapter contract와 누락 진단부터 정의한다.

### P2 — Nestarc ecosystem compatibility harness

1. 별도 fixture application/repository에 둔다.
2. 실제 package tarball 또는 published version을 설치해 검증한다.
3. API key → RBAC → DB → job/outbox → webhook 전체 context propagation을 검사한다.
4. cross-tenant data와 side effect가 모두 차단되는지 검증한다.

### 보류 — TypeORM·Drizzle

Prisma/PostgreSQL의 production contract가 안정될 때까지 adapter 구현을 보류한다. 동시에 roadmap에서 완료되지 않은 adapter 약속과 Phase 상태를 현실에 맞게 수정한다.

## 7. 다음 세션 시작 체크리스트

다음 세션은 아래 순서로 시작한다.

1. 이 문서를 먼저 읽는다.
2. `git status --short`, `git log -1 --oneline`, `package.json` version을 확인한다.
3. 기준 커밋 `2fe5288` 이후 transaction, CLI, E2E, CI 변경 여부를 diff한다.
4. 구현 요청이 아니라 재검증 요청이면 먼저 전체 unit/build/lint/E2E를 다시 실행한다.
5. 시장 판단이 필요하면 npm 수치와 Prisma/Yates/UseBetter 상태를 다시 조회한다.
6. 다음 구현 작업은 PgBouncer matrix 또는 transaction API 신뢰성 강화에서 독립 작업 단위를 선택한다.

추천 첫 구현 작업:

> PgBouncer transaction mode Compose profile을 만들고, pool size 1에서 tenant A → tenant B → no-context 및 commit/rollback/error cleanup을 실DB E2E로 검증한다.

## 8. 세션 재개용 짧은 프롬프트

새 세션에서 아래와 같이 요청하면 된다.

```text
docs/tenancy-strategy-validation-2026-08-21.md를 읽고 현재 HEAD와 차이를 확인한 뒤,
완료된 live DB doctor/RLS P0의 회귀를 보존하면서 P0/P1 PgBouncer matrix의 다음 미완료 작업을 구현해 주세요.
시장 수치는 스냅샷이므로 구현 판단에 필요할 때만 최신화하세요.
```
