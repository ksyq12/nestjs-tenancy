# `@nestarc/tenancy` 전략·기능 검증 및 세션 인수인계

> [!IMPORTANT]
> 이 문서의 조사 근거와 완료 증거는 유효하지만 7절과 8절의 실행 지침은 superseded되었다.
> 현재 작업 선택, 상태, 완료 조건과 인계는
> [`2026-08-28-v0.15.0-maintenance-work-plan.md`](./2026-08-28-v0.15.0-maintenance-work-plan.md)를 따른다.

- 작성일: 2026-08-21 (Asia/Seoul)
- 최초 검증 기준 커밋: `2fe5288` (`Release version 0.14.0`)
- 검증 패키지 버전: `0.15.0`
- P0 구현 완료: 2026-08-21 (`live DB doctor` + 실제 owner/FORCE 및 active RLS E2E)
- P0/P1 PgBouncer matrix 완료: 2026-08-23 (transaction mode 지원 계약 + Prisma 6/7 실DB lane)
- P1 transaction API 대표 경로 완료: 2026-08-23 (`maxWait`·failure/custom key/isolation 계약 + transparent mode deprecation)
- P1 non-HTTP missing-context diagnostics 완료: 2026-08-23 (`ignore | warn | throw` + event/OTel metric + BullMQ/Redis E2E + search contract)
- P2 Nestarc ecosystem compatibility harness 완료: 2026-08-23 (strict tarball install + API key/RBAC/RLS/outbox/jobs/webhook 실경로 + CI/release gate)
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
| 안정적인 interactive transaction API | P1 대표 경로 정리 완료 + 런타임 제약 명시 | public API 기반 `tenancyTransaction()`을 canonical API로 고정하고 `maxWait`·timeout·isolation·custom key·시작/설정 실패 계약을 Prisma 6/7 실DB matrix로 검증했다. transparent mode는 deprecated compatibility 경로다. Prisma 6 `PrismaPg`의 `maxWait` 미시행은 negative contract로 명시한다. |
| PgBouncer/pool E2E | P0/P1 구현 완료 + 지원 범위 고정 | PgBouncer 1.25.2 transaction mode를 지원 계약으로 정하고, 강제 재사용·교체·동시성·실패 cleanup을 Prisma 6/7 실DB lane에서 검증한다. session mode는 비지원 negative contract다. |
| 패키지 간 통합 테스트 키트 | P2 strict install 포함 완료 | 독립 fixture가 실제 tarball/published package를 strict 설치하고 API key → tenancy → RBAC → RLS DB → outbox → jobs → webhook을 검증한다. 로컬 API Keys tarball의 optional Prisma peer는 실DB 검증에 근거해 `^5.0.0 || ^6.0.0`으로 확대됐고 runner에서 peer bypass flag를 제거했다. |
| Redis·검색·queue 누락 진단 | P1 구현 완료 + vendor 범위 명시 | 기본 호환 동작을 보존하는 공통 `ignore | warn | throw` 정책과 event/OTel 진단을 Bull/Kafka/gRPC/cache/Redis/search에 연결했다. BullMQ 6 + Redis 7.4 실환경 lane을 CI/release gate로 추가했고 search는 vendor-neutral adapter contract까지만 보증한다. |
| 운영 DB `doctor` | P0 구현 완료 + 후속 범위 분리 | live DB catalog/role/policy와 opt-in active fail-closed probe를 구현했다. manifest batch는 후속이며, PgBouncer 재사용은 별도 matrix에서 완료했다. |
| TypeORM·Drizzle 보류 | 합리적인 전략 결정 | 패키지는 이미 Prisma/PostgreSQL 전용이다. 현재의 문제는 ORM 확장이 아니라 로드맵의 과잉 약속과 핵심 경로의 운영 보증 부족이다. |
| 자체 수요가 가장 강하고 선점 가능 | 공개 근거 부족 및 일부 반증 | 더 많이 다운로드되는 직접 경쟁 패키지와 Prisma 공식 RLS가 존재한다. 경쟁 우위는 RLS 자체보다 NestJS 운영 통합에서 찾아야 한다. |

핵심적으로, 최초 조사는 “현재 패키지가 깨져 있다”는 결론이 아니었다. 기본 경로의 테스트는 모두 통과했고 조건부 호환성 결함, 잘못 이름 붙은 E2E 한 건, production guarantee의 공백을 확인했다. live doctor/FORCE RLS P0, PgBouncer P0/P1 matrix, transaction API P1 대표 경로, non-HTTP missing-context diagnostics P1, strict install을 포함한 Nestarc ecosystem compatibility harness P2를 완료했다. 하네스가 드러낸 API Keys peer metadata와 Jobs handler 초기화 cross-package 공백도 각각 `0.3.1` release와 published-only E2E로 닫았다.

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
npm run test:cov -- --runInBand
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

### 3.4 P0/P1 PgBouncer matrix 구현 후 실행 검증

PgBouncer 지원 계약과 CI/release gate를 추가한 뒤 다음을 실행했다.

```bash
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run build
npm run lint
npm run test:e2e
npm run test:e2e:pgbouncer
```

Prisma 6 lane은 CI와 동일하게 `prisma`, `@prisma/client`, `@prisma/adapter-pg`를 6.x로 교체한 뒤 같은 PgBouncer 명령을 실행했다.

결과:

- unit/coverage: 43 suites, 523 tests 통과
- coverage: 전체 statements 99.21%, branches 97.51%, functions 100%, lines 99.24%
- build 및 lint: 통과
- direct PostgreSQL E2E: 3 suites, 31 tests 통과
- PgBouncer + Prisma 7.9.1: 적용 대상 13 tests 통과, Prisma 6 native 전용 3 tests skip
- PgBouncer + Prisma 6.19.3: 16 tests 모두 통과
- 실행 환경: 로컬 Node.js 24.11.1, PostgreSQL 16.14, PgBouncer 1.25.2; CI PgBouncer lane은 Node.js 22
- transaction pool size 1에서 동일 물리 backend PID로 tenant A → tenant B → no-context를 실행해 context 잔류가 없음을 확인했다.
- commit, callback rollback, DB error rollback, interactive transaction timeout과 높은 논리 동시성 뒤 cleanup을 확인했다.
- pool size 2에서 실제 두 backend의 병렬 사용과 `RECONNECT` 이후 새 backend의 clean state를 확인했다.
- helper, 기본 batch extension, transparent interactive mode를 독립 시나리오로 기록했다. named prepared statement positive assertion은 이를 지원하는 Prisma 7 adapter에서 수행하며, Prisma 6 adapter는 callback 지원 여부에 따라 조건부로 관찰한다.
- CI와 release가 Prisma 6/7 PgBouncer job을 통과해야 하며, release publish는 이 job을 필수 선행 조건으로 둔다.

### 3.5 P1 transaction API 대표 경로 정리 후 실행 검증

public helper option/failure contract와 transparent mode 방향을 정리한 뒤 다음을 실행했다.

```bash
npm run lint
npm test -- --runInBand
npm run build
npm run test:e2e
npm run test:e2e:pgbouncer # Prisma 7.9.1
npm install prisma@6.19.3 @prisma/client@6.19.3 @prisma/adapter-pg@6.19.3 --no-save
npm run test:e2e:pgbouncer # Prisma 6.19.3
```

결과:

- lint/build: 통과
- unit: 43 suites, 525 tests 통과
- direct PostgreSQL E2E: 3 suites, 31 tests 통과
- PgBouncer + Prisma 7.9.1: 17 tests 통과, 버전 비대상 5 tests skip
- PgBouncer + Prisma 6.19.3: 21 tests 통과, 버전 비대상 1 test skip
- helper가 `maxWait`를 Prisma `$transaction()`에 전달하며, Prisma 7 `PrismaPg`와 Prisma 6 native engine에서 connection-pool contention에 의한 transaction 시작 timeout 및 callback 미호출을 실DB로 확인했다.
- Prisma 6.19.3 `PrismaPg`는 `maxWait`를 받아도 adapter connection-pool contention에서 시행하지 않고 대기 후 callback을 실행한다. 이를 지원한다고 과장하지 않고 명시적 negative contract로 고정했다.
- custom setting key가 transaction-local로만 유지되고 기본 key를 건드리지 않는지, `Serializable`이 실제 PostgreSQL isolation level인지 확인했다.
- 변경 불가능한 PostgreSQL setting을 사용해 `set_config` 실패를 주입하고 callback 미호출과 clean backend를 확인했다.
- transparent `interactiveTransactionSupport`는 전체 Prisma 내부 metadata shape를 fail-fast 검증할 수 없으므로 deprecated compatibility 경로로 결정했다. 기존 소비자 회귀를 위해 Prisma 6/7 E2E는 유지한다.

### 3.6 P1 non-HTTP missing-context diagnostics 구현 후 실행 검증

공통 policy, event/telemetry, Redis/search resource contract와 BullMQ/Redis lane을 추가한 뒤 다음을 실행했다.

```bash
npm run lint
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run build
npm run test:e2e
npm run test:e2e:redis
npm run test:e2e:pgbouncer # Prisma 7.9.1 regression
npm pack --dry-run
npm audit --json
```

결과:

- lint/build: 통과
- unit/integration: 46 suites, 550 tests 통과
- coverage: 전체 statements 99.05%, branches 96.88%, functions 100%, lines 99.21%
- direct PostgreSQL E2E: 3 suites, 31 tests 통과
- BullMQ 6.2.0 + ioredis 6.0.0 + Redis 7.4.10: 1 suite, 3 tests 통과
- Prisma 7.9.1 PgBouncer regression: 17 tests 통과, 버전 비대상 5 tests skip
- package dry-run: 신규 diagnostics/resources JavaScript와 declaration을 포함한 113 files 확인
- 실제 Redis에서 tenant A/B job이 복원된 context로 서로 다른 collision-safe key를 기록하는 것을 확인했다.
- `throw` policy에서 producer 누락은 enqueue 전에 실패하고, raw unscoped job은 consumer resource 접근 전에 실패하는 것을 확인했다.
- `npm audit`의 10건(2 low, 8 high)은 기존 Nest/Prisma/빌드 도구 전이 의존성에서 보고되며 신규 `bullmq`/`ioredis` 경로는 finding에 포함되지 않았다.

### 3.7 P2 Nestarc ecosystem compatibility harness 구현 후 실행 검증

독립 fixture, tarball 설치 runner, CI/release gate를 추가한 뒤 다음을 실행했다.

```bash
npm run lint
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run build
npm run test:e2e:ecosystem
```

결과:

- lint/build: 통과
- unit/integration: 47 suites, 554 tests 통과
- coverage: 전체 statements 99.05%, branches 96.88%, functions 100%, lines 99.21%
- ecosystem E2E: 1 suite, 3 tests 통과
- 로컬 검증 환경: Node.js 24.11.1, NestJS 10.4.20, Prisma 6.19.3, PostgreSQL 16.14
- CI/release lane은 Node.js 22와 PostgreSQL 16에서 같은 명령을 실행하며 release publish의 필수 선행 job이다.
- 현재 `@nestarc/tenancy@0.15.0`과 로컬 형제 저장소의 `api-keys@0.3.1`, `rbac@0.2.0`, `jobs@0.3.1`, `outbox@0.2.0`, `webhook@0.13.0`을 각각 tarball로 설치해 검증했다. API Keys와 Jobs `0.3.1` 배포 후 형제 저장소 탐색을 비활성화한 published-only strict lane도 재실행해 실제 npm package 설치, Prisma 6 client 생성, installed artifact version, 두 핵심 runtime scenario를 포함한 3개 test가 모두 통과했다.
- API key로 tenant identity를 결정하고 선택적 `X-Tenant-Id` assertion의 불일치를 403으로 차단했다. 같은 identity가 tenancy ALS, RBAC subject/tenant, Prisma transaction-local RLS setting에 사용되는 것을 확인했다.
- tenant A/B가 각각 자기 RLS row만 조회하고, outbox record의 tenant가 jobs context로 복원되며, webhook event/endpoint filtering과 서명된 실제 HTTP delivery가 해당 tenant 수신 경로에만 도달하는 것을 확인했다.
- API key 누락, API key와 asserted tenant 불일치, RBAC role 누락은 모두 project/outbox/webhook side effect 이전에 실패했다.
- API Keys의 Prisma 5.22.0/6.19.3 실DB storage contract와 tarball consumer 검증 후 optional `@prisma/client` peer가 `^5.0.0 || ^6.0.0`으로 확대됐다. fixture runner는 `--legacy-peer-deps`와 `--force` 없이 strict `npm install`을 사용하며 로컬 API Keys tarball로 전체 runtime graph를 통과했다.
- `@nestarc/jobs@0.3.1`은 decorator discovery와 worker/consumer 시작을 application bootstrap으로 지연하고 singleton handler 등록 완료 후 소비를 시작한다. 하네스는 constructor-injected `WebhookPublishHandler`의 `@JobHandler('webhook.publish')` 자동 발견을 사용하며 수동 `HandlerRegistry` workaround를 제거했다.

## 4. 상세 검증 결과

### 4.1 Interactive transaction: P1 대표 경로 정리 완료

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

#### transparent mode 결정: deprecated compatibility 경로

`interactiveTransactionSupport: true`인 선택적 transparent mode는 다음 Prisma 내부 구조를 사용한다.

- `_createItxClient`: [`src/prisma/prisma-tenancy.extension.ts`](../src/prisma/prisma-tenancy.extension.ts#L11)
- `__internalParams.transaction`: 같은 파일 18행 이후
- runtime 감지 및 내부 client 생성: 같은 파일 171행 이후
- startup 검증: 같은 파일 114행 이후

startup에서는 `_createItxClient` 존재만 확인한다. Prisma가 `__internalParams` 또는 `transaction.kind`의 shape를 변경하면 startup 검사를 통과한 뒤 일반 batch transaction 경로로 조용히 fallback할 수 있다. query가 interactive transaction 내부인지 공개 API로 판별할 수 없어 전체 shape의 안전한 사전 fail-fast는 구현할 수 없다. 따라서 이 옵션에 TypeScript `@deprecated`를 표시하고 신규 사용은 `tenancyTransaction()`으로 고정했다. 기존 소비자를 즉시 깨지 않도록 구현과 exact-version 회귀 E2E는 유지한다.

- 기존 감사 기록: [`docs/code-review-2026-04-07.md`](./code-review-2026-04-07.md#L85)
- metadata 부재 시 fallback을 기대하는 테스트: [`test/prisma-tenancy.extension.spec.ts`](../test/prisma-tenancy.extension.spec.ts#L772)

이는 현재 Prisma 6.19.3/7.9.1에서 재현되는 장애가 아니라, 내부 contract 변경 시 fail-fast하지 못하는 조건부 호환성 결함이다.

#### 완료된 public helper 계약과 잔여 런타임 제약

- helper option은 Prisma의 public interactive transaction option인 `maxWait`, `timeout`, `isolationLevel`을 구조적으로 전달하고 별도 `dbSettingKey`를 지원한다.
- unit test는 실제 setting key/tenant 값 바인딩, callback 이전 `set_config` 실행 순서, 시작/설정 실패 시 callback 미호출을 검증한다.
- Prisma 6/7 `PrismaPg` 실DB lane에서 custom key의 transaction-local 의미, 실제 `Serializable`, `set_config` 실패, callback/DB error/timeout cleanup을 검증한다.
- transaction 시작 실패는 Prisma 7 `PrismaPg`와 Prisma 6 native engine에서 `maxWait`로 검증한다.
- Prisma 6.19.3 `PrismaPg`는 adapter pool contention에서 `maxWait`를 시행하지 않는다. helper가 안전하게 이를 보완할 수 없으며, caller에게 먼저 timeout을 반환하면 queued transaction과 callback이 나중에 실행될 수 있으므로 자체 `Promise.race` timeout은 구현하지 않는다.
- direct PostgreSQL 전용 E2E는 기본 Prisma 7 개발 버전 한 lane이며, managed pooler/다른 adapter의 option 시행 여부는 이 matrix의 보증 범위가 아니다.

#### 결정 결과

- `tenancyTransaction()`을 canonical/권장 경로로 유지한다.
- Prisma 6에서 transaction 시작 대기 상한이 필수이면 native engine을 사용하거나 helper 호출 전 admission control을 둔다.
- transparent mode는 deprecated compatibility 경로로 유지하고 신규 코드는 사용하지 않는다.

### 4.2 PgBouncer/connection pool E2E: P0/P1 지원 계약 구현 완료

#### 지원 계약

- 지원 pool mode는 PgBouncer **transaction mode**다. 이는 Prisma의 공식 PgBouncer 계약과 일치한다.
- 검증 기준은 PostgreSQL 16.14와 보안 수정이 포함된 PgBouncer 1.25.2이며, Compose image를 tag와 digest로 고정했다.
- `max_prepared_statements = 200`을 명시한다. PgBouncer 1.21 이상에서는 Prisma URL에 과거 호환용 `pgbouncer=true`를 붙이지 않는다.
- matrix의 fixture setup은 direct PostgreSQL URL로 실행한다. 운영에서도 Prisma CLI/migration은 direct URL을 사용하고 application query만 PgBouncer로 보낸다.
- session mode는 지원 범위가 아니다. pool size 1에서 첫 logical client가 backend를 pin하고 다음 client가 첫 client의 disconnect까지 대기하는 negative contract를 유지한다.
- 이 matrix는 현재 명시한 self-hosted 구성의 보증이다. 임의의 managed pooler 설정이나 Prisma 8 Early Access까지 일반화하지 않는다.
- runner는 Prisma CLI/client/adapter major가 모두 같은 지원 버전 6 또는 7인지 시작 시 검사하고, 혼합 설치와 Prisma 8은 fail-fast 처리한다.

공식 근거:

- [Prisma PgBouncer 연결 가이드](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- [PgBouncer prepared statement 설정](https://www.pgbouncer.org/config#max_prepared_statements)
- [PostgreSQL `set_config(..., true)` 계약](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET)

#### 재현 환경

대표 재현 명령 `npm run test:e2e:pgbouncer`은 Compose lifecycle, Prisma client 생성과 아래 세 lane의 Jest 검증을 한 번에 수행한다.

| Host port | Mode | 물리 pool | 목적 |
| ---: | --- | ---: | --- |
| `6432` | transaction | 1 | 강제 재사용, 순차 격리, 실패/timeout/동시성 cleanup |
| `6433` | session | 1 | pinning과 starvation을 고정하는 비지원 negative test |
| `6434` | transaction | 2 | 실제 병렬 backend 사용, cleanup, connection 교체 |

구현 근거:

- Compose profile과 고정 image: [`docker-compose.yml`](../docker-compose.yml)
- 고정 PgBouncer 설정: [`test/e2e/pgbouncer/`](../test/e2e/pgbouncer/)
- 재현 runner: [`scripts/test-pgbouncer-e2e.js`](../scripts/test-pgbouncer-e2e.js)
- 보안 시나리오: [`test/e2e/pgbouncer/pgbouncer.e2e-spec.ts`](../test/e2e/pgbouncer/pgbouncer.e2e-spec.ts)

#### 검증된 동작

- transaction pool size 1의 동일 backend PID에서 `tenancyTransaction()`으로 tenant A → tenant B → no-context를 순서대로 실행해 tenant setting이 다음 transaction에 남지 않음을 검증한다.
- 정상 commit, callback error rollback, DB error rollback, Prisma interactive transaction timeout 뒤 clean state를 검증한다.
- pool size 1보다 많은 logical client를 동시에 실행해 queueing 중에도 tenant별 결과가 섞이지 않는지 검증한다.
- pool size 2에서 두 물리 backend가 실제로 겹쳐 사용되는지 확인하고, 양쪽의 no-context 상태와 PgBouncer `RECONNECT` 뒤 새 backend의 clean state를 확인한다.
- canonical helper, 기본 batch extension, 선택적 transparent interactive mode를 별도 결과로 기록한다.
- Prisma 7 PrismaPg adapter의 opt-in named prepared statement가 PgBouncer를 통과하는지 검증한다. Prisma 6 adapter는 callback을 지원하는 경우에만 같은 positive assertion을 적용한다.
- Prisma 7은 driver adapter lane, Prisma 6은 driver adapter와 native engine lane을 함께 실행한다.
- CI/release는 검증 버전 6.19.3과 7.9.1을 고정해 matrix를 실행하며, release publish도 두 lane의 성공을 요구한다.

이 결과는 최초 문서의 “현재 leak 확인”이 아니라 “production claim을 뒷받침할 matrix 부재”였던 공백을 닫는다. 다만 transparent mode의 Prisma 내부 API 의존 위험과 managed pooler별 구성 차이는 별도 잔여 위험이다.

### 4.3 Cross-package integration kit: P2 strict install 포함 완료

> [!NOTE]
> 아래 자동 sibling 탐색 설명은 2026-08-23 당시 구현의 역사적 기록이다.
> TEN-M19에서 이 ambient 동작을 제거하고 committed lock 기반
> `published-only`와 명시적 tenancy tarball `local-artifact` 모드로 대체했다.
> 현재 실행 계약은 [`test/ecosystem/fixture/README.md`](../test/ecosystem/fixture/README.md)를 따른다.

`@nestarc/tenancy/testing`의 기존 단일 패키지 helper 세 개는 그대로 유지한다.

- `TestTenancyModule`
- `withTenant`
- `expectTenantIsolation`

ecosystem 패키지를 `tenancy` runtime dependency로 추가하지 않았다. 대신 [`test/ecosystem/fixture`](../test/ecosystem/fixture/)를 자체 `package.json`, TypeScript/Jest/Prisma 설정을 가진 독립 consumer application으로 두었다.

2026-08-23 당시 대표 명령 [`npm run test:e2e:ecosystem`](../package.json)은 다음 순서로 실행됐다.

1. 현재 `dist`에서 `@nestarc/tenancy` tarball을 만들었다.
2. 로컬 형제 Nestarc 저장소와 빌드 산출물이 있으면 해당 package도 tarball로 만들었다.
3. 형제 저장소가 없는 CI에서는 fixture에 고정된 published version을 사용했다.
4. fixture 전체를 임시 디렉터리로 복사하고 package spec을 tarball absolute path로 교체했다.
5. 독립 `node_modules`를 설치하고 Prisma 6 client를 생성했다.
6. PostgreSQL schema/RLS fixture, Nest application, 실제 HTTP webhook receiver를 실행했다.

```text
api-keys → tenancy ALS → rbac → Prisma/RLS + outbox → jobs → webhook HTTP
```

검증된 계약:

1. 실제 `ApiKeysService`가 API key의 tenant identity를 결정한다.
2. tenancy HTTP middleware가 그 identity로 ALS context를 생성하고 asserted tenant mismatch를 거부한다.
3. RBAC가 API key subject와 같은 tenant의 role/permission을 평가한다.
4. `tenancyTransaction()`이 Prisma transaction-local RLS setting을 적용하고 project row와 outbox row를 원자적으로 기록한다.
5. outbox publisher가 record tenant/correlation을 jobs envelope에 넣고 consumer context runner가 ALS를 복원한다.
6. webhook service가 tenant endpoint만 선택하고 worker가 HMAC 서명된 실제 HTTP request를 전송한다.
7. tenant A/B의 DB row, job context, webhook event와 외부 side effect가 서로 섞이지 않는다.
8. missing identity, tenant mismatch, RBAC deny는 data/side effect 이전에 fail-closed한다.

구현 근거:

- runner: [`scripts/test-ecosystem-e2e.js`](../scripts/test-ecosystem-e2e.js)
- 독립 fixture: [`test/ecosystem/fixture`](../test/ecosystem/fixture/)
- runner unit contract: [`test/cli/ecosystem-e2e-runner.spec.ts`](../test/cli/ecosystem-e2e-runner.spec.ts)
- CI/release gate: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`.github/workflows/release.yml`](../.github/workflows/release.yml)

잔여 제약:

- 로컬 tarball과 npm published `@nestarc/api-keys@0.3.1`의 strict install을 보증한다. published-only 재검증에서 설치 artifact version과 runtime behavior를 포함한 전체 3개 test가 통과했으며 API Keys peer metadata 관련 잔여 workaround는 없다.
- 현재 cross-package runtime lane은 모든 패키지의 교집합인 NestJS 10 + Prisma 6이다. Prisma 7 전체 ecosystem lane은 api-keys/rbac/outbox/webhook의 peer 및 runtime 지원이 먼저 필요하다.
- Jobs `0.3.1`의 application-bootstrap discovery로 상위 module provider의 constructor DI와 `onModuleInit()` 이후 handler 등록을 보증한다. request/transient 또는 non-static dependency tree handler는 fail-fast하며, in-memory/BullMQ와 Nest 10/11 회귀 matrix가 이를 보존한다.
- in-memory jobs backend를 사용하지만 outbox persistence, Prisma/RLS DB, webhook persistence/worker/HTTP transport는 실제 구현이다. Redis/BullMQ 내구성은 별도 P1 Redis lane이 담당한다.

### 4.4 Redis·검색·queue context 누락 진단: P1 구현 완료

#### 공통 policy와 진단 신호

[`TenantContextDiagnostics`](../src/diagnostics/tenant-context-diagnostics.ts)는 non-HTTP 누락을 다음 한 계약으로 처리한다.

```text
ignore | warn | throw
```

- 기본값 `ignore`는 기존 silent/pass-through 동작을 보존하며 event/telemetry도 만들지 않는다.
- `warn`은 구조화된 진단을 보고한 뒤 기존 동작을 계속한다.
- `throw`는 동일한 진단을 먼저 보고하고 `TenantContextMissingError`를 던진다.
- `TenancyModuleOptions.missingContext`로 module-level policy를 구성하며 diagnostics provider를 export한다.
- 각 진단은 `transport`, `operation`, 선택적 stable `resource`만 담는다. tenant ID, payload, Redis key, query 본문은 기록하지 않는다.
- reporter/hook 실패는 원래 warn/throw policy를 바꾸지 않도록 격리한다.

진단 연결:

- event: `tenant.context_missing`과 type-safe payload mapping
- active OpenTelemetry span event: `tenant.context_missing`
- metric counter: `nestarc.tenancy.missing_context`
- OTel attributes: `tenant.transport`, `tenant.operation`, 선택적 `tenant.resource`
- 대상: Bull/Kafka/gRPC inject/extract, RPC consumer interceptor, tenant cache, Redis/search resource helper

구현 근거:

- 공통 policy/reporter: [`src/diagnostics/tenant-context-diagnostics.ts`](../src/diagnostics/tenant-context-diagnostics.ts)
- event contract: [`src/events/tenancy-events.ts`](../src/events/tenancy-events.ts)
- OTel span event/counter: [`src/telemetry/tenancy-telemetry.service.ts`](../src/telemetry/tenancy-telemetry.service.ts)
- module provider: [`src/tenancy.module.ts`](../src/tenancy.module.ts)
- propagator/consumer: [`src/propagation/`](../src/propagation/)
- cache 연결: [`src/cache/tenant-cache.interceptor.ts`](../src/cache/tenant-cache.interceptor.ts)

HTTP는 이 policy의 대상이 아니다. 기존 middleware의 `tenant.not_found` event와 guard의 tenant 누락 403 계약을 유지한다.

#### Redis/search resource contract

- [`TenantResourceKey`](../src/resources/tenant-resource-key.ts)는 tenant ID 길이 prefix를 포함하는 collision-safe Redis/search identifier를 만든다.
- missing context에서는 adapter/resource를 호출할 수 있도록 unscoped key를 만들지 않고 `null`을 반환하며, `throw` policy이면 그 전에 실패한다.
- [`TenantSearch`](../src/resources/tenant-search.ts)는 `{ tenantId, index }` scope를 vendor adapter에 명시적으로 넘긴다.
- missing context에서는 search adapter를 절대 호출하지 않는다. `ignore/warn`은 `null`, `throw`는 예외가 계약이다.
- Elasticsearch/OpenSearch/Typesense 등 특정 vendor client와 index filter 구현은 이 P1의 보증 범위가 아니다.

#### 실제 BullMQ/Redis E2E와 gate

- Compose는 Redis 7.4.10 Alpine image를 tag+digest로 고정한다.
- E2E dev runtime은 BullMQ 6.2.0과 ioredis 6.0.0이며 package runtime dependency에는 추가하지 않았다.
- [`test/e2e/redis/bullmq-redis.e2e-spec.ts`](../test/e2e/redis/bullmq-redis.e2e-spec.ts)는 실제 queue/worker/Redis를 사용한다.
- tenant A/B job의 context 복원과 실제 Redis key/value 격리를 검증한다.
- missing producer context가 enqueue 전에 실패하는지 검증한다.
- raw unscoped job이 processor의 Redis 접근 전에 실패하고 tenant key를 쓰지 않는지 검증한다.
- CI와 release publish gate에 독립 `redis-e2e` job을 추가했다.

잔여 제약:

- propagator와 interceptor를 수동 생성할 때는 module에서 export한 diagnostics instance를 명시적으로 전달해야 한다.
- transport 자동 감지는 tenant key 자체가 없는 Bull payload를 Bull로 판별할 수 없으므로 consumer 진단에는 명시적 `transport: 'bull'`이 권장된다.
- cache는 Nest DI에서 module-level diagnostics를 자동으로 받을 수 있다. 명시적으로 shared 처리한 route는 missing-context 진단 대상이 아니다.
- OTel API/SDK 또는 meter provider가 없으면 span event/counter는 정상적으로 no-op이다.
- 실제 vendor search engine E2E와 Redis client abstraction은 의도적으로 추가하지 않았다. 현재 보증은 resource scoping, adapter 미호출, 누락 진단 계약이다.

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

현재 명령은 invocation당 한 테이블을 명시적으로 감사한다. schema/manifest 전체를 한 번에 순회하는 batch mode, extra restrictive policy drift, domain NOT NULL/identity column, partial/INCLUDE index의 더 엄격한 분류는 비차단 후속이다. PgBouncer 물리 connection 재사용은 별도 P0/P1 matrix에서 검증했으며, `doctor` 자체가 pool 상태를 진단한다고 해석하면 안 된다.

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

구현 전에는 다음 상태를 검증하지 못했다. 현재는 위 `doctor`가 catalog/active-probe P0 범위를 담당하고, 마지막 PgBouncer 항목은 별도 matrix가 담당한다.

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

초기 권고는 catalog audit와 active behavior probe를 구분하고 Nestarc의 DB setting key, application role, missing-context semantics까지 검사하는 것이었다. 이 범위는 구현되었다. `tenancyTransaction()` 경로 및 pool reuse는 `doctor`가 과도한 보증을 주장하지 않도록 분리했고, 별도의 transaction/PgBouncer matrix에서 완료했다.

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

- 현재 adapter 상태: [`docs/roadmap.md`](./roadmap.md)
- M10 이전 v1 summary의 superseded adapter 약속: [`c9c448b` 시점 roadmap](https://github.com/nestarc/nestjs-tenancy/blob/c9c448ba4e4e7b7ed5634c29516dc7a30376d728/docs/roadmap.md)

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

### P0/P1 — PgBouncer matrix ✅ 완료 (2026-08-23)

1. ✅ 재현 가능한 PgBouncer Compose profile을 만들고 PostgreSQL/PgBouncer image를 고정했다.
2. ✅ transaction mode를 최소 지원 계약으로 정하고 session mode negative contract를 추가했다.
3. ✅ pool size 1, tenant A → B → no-context를 동일 물리 backend에서 검증했다.
4. ✅ commit/rollback/DB error/timeout/동시성, pool size 2 교체·재사용을 검증했다.
5. ✅ Prisma 6/7 실DB lane을 CI와 release gate에 추가했다.

### P1 — transaction API 대표 경로 정리 ✅ 완료 (2026-08-23)

1. ✅ `tenancyTransaction()`을 canonical/권장 API로 문서화하고 Prisma 6/7 PgBouncer helper lane을 추가했다.
2. ✅ `maxWait`를 public option에 추가하고 Prisma 7 adapter/Prisma 6 native positive contract와 Prisma 6 adapter negative contract를 정의했다.
3. ✅ callback error·DB error rollback과 timeout cleanup 실DB E2E를 추가했다.
4. ✅ `set_config` 실패·transaction 시작 실패·custom key·isolation level 실DB E2E를 추가했다.
5. ✅ transparent internal mode를 deprecated compatibility 경로로 결정하고 exact-version 회귀 E2E를 유지했다.

### P1 — non-HTTP missing-context diagnostics ✅ 완료 (2026-08-23)

1. ✅ 기존 기본 동작을 보존하는 공통 `ignore | warn | throw` policy를 구현했다.
2. ✅ `tenant.context_missing` event, active OTel span event, metric counter를 transport/resource별로 연결했다.
3. ✅ 실제 BullMQ 6/Redis 7.4 E2E와 CI/release gate를 만들었다.
4. ✅ vendor-neutral search adapter contract와 adapter 미호출 누락 계약을 정의했다.

### P2 — Nestarc ecosystem compatibility harness ✅ strict install 포함 완료 (2026-08-23)

1. ✅ 독립 fixture application을 만들고 `tenancy` runtime dependency와 분리했다.
2. ✅ 실제 package tarball 또는 고정 published version을 독립 `node_modules`에 설치한다.
3. ✅ API key → tenancy → RBAC → RLS DB/outbox → jobs → webhook 전체 context propagation을 검사한다.
4. ✅ cross-tenant data와 실제 HTTP side effect가 모두 분리되는지 검증한다.
5. ✅ CI/release publish gate에 Node 22 ecosystem job을 추가했다.
6. ✅ API Keys의 Prisma 5/6 peer metadata와 실DB contract를 정리하고 peer bypass flag 없는 clean strict install을 통과했다.
7. ✅ npm published `@nestarc/api-keys@0.3.1`만 사용하는 published-only strict lane 3개 test를 통과했다.
8. ✅ Jobs `0.3.1`의 bootstrap handler discovery를 적용해 manual registry workaround를 제거하고 published-only strict lane 3개 test를 통과했다.

### 보류 — TypeORM·Drizzle

Prisma/PostgreSQL의 production contract가 안정될 때까지 adapter 구현을 보류한다. 동시에 roadmap에서 완료되지 않은 adapter 약속과 Phase 상태를 현실에 맞게 수정한다.

## 7. 다음 세션 시작 체크리스트

다음 세션은 아래 순서로 시작한다.

1. 이 문서를 먼저 읽는다.
2. `git status --short`, `git log -1 --oneline`, `package.json` version을 확인한다.
3. 기준 커밋 `2fe5288` 이후 transaction, CLI, E2E, CI 변경 여부를 diff한다.
4. 구현 요청이 아니라 재검증 요청이면 전체 unit/build/lint/direct E2E와 Prisma 6/7 PgBouncer E2E를 다시 실행한다.
5. 시장 판단이 필요하면 npm 수치와 Prisma/Yates/UseBetter 상태를 다시 조회한다.
6. API Keys와 Jobs cross-package workaround는 완료됐다. 다음 구현은 이 문서의 완료 계약을 회귀 gate로 보존하면서 별도 범위로 결정한다.

추천 후속 구현 작업:

> 다음 기능 범위를 결정하기 전에 전체 회귀 suite와 ecosystem published-only lane을 실행하고, Prisma 7 ecosystem 확대 또는 보류 중인 roadmap 항목을 별도 제안으로 평가한다.

## 8. 세션 재개용 짧은 프롬프트

새 세션에서 아래와 같이 요청하면 된다.

```text
docs/tenancy-strategy-validation-2026-08-21.md를 읽고 현재 HEAD와 차이를 확인한 뒤,
완료된 live DB doctor/RLS P0, PgBouncer P0/P1 matrix, transaction API P1 대표 경로,
non-HTTP missing-context diagnostics P1과 ecosystem compatibility harness P2의 회귀를 보존하면서
API Keys/Jobs cross-package 계약을 포함한 ecosystem harness의 회귀를 확인하고 다음 별도 범위를 제안해 주세요.
시장 수치는 스냅샷이므로 구현 판단에 필요할 때만 최신화하세요.
```
