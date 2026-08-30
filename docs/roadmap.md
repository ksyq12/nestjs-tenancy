# `@nestarc/tenancy` Roadmap

> 기준선: published `v0.16.0` (2026-08-30)<br>
> 최종 갱신: 2026-08-30 (Asia/Seoul)

이 문서는 제품 방향과 이미 제공되는 기능을 요약한다. 현재 작업의 순서, 담당 상태, 완료 조건은
[`2026-08-28-v0.15.0-maintenance-work-plan.md`](./2026-08-28-v0.15.0-maintenance-work-plan.md)를
단일 실행 기준으로 사용한다. 정확한 릴리스별 변경 내역은 [`CHANGELOG.md`](../CHANGELOG.md)를 따른다.

과거 roadmap, handover, plan/spec의 미체크 항목은 당시의 아이디어나 실행 메모일 뿐 현재 backlog나
릴리스 약속이 아니다. 후보는 근거와 승인된 작업 ID가 생겼을 때만 현재 계획으로 승격한다.

## 상태 정의

| 상태 | 의미 |
| --- | --- |
| `완료` | published release 또는 공식 delivery surface에서 사용 가능한 기능 |
| `검증됨` | 구현뿐 아니라 명시된 자동화 또는 실제 인프라 검증 근거가 있는 운영 계약 |
| `보류` | 필요성은 알려졌지만 현재 release scope나 일정에 포함하지 않은 항목 |
| `제안` | 수요·위협 모델·설계·검증 비용을 평가한 뒤 별도 작업으로 승인해야 하는 후보 |

## v0.16 현재 범위

`@nestarc/tenancy`는 NestJS request context와 PostgreSQL RLS를 Prisma에 연결하는 패키지다.
현재 제품 범위는 Prisma/PostgreSQL 운영 계약이며, 범용 ORM 추상화나 모든 멀티테넌시 배치 전략을
동시에 제공하는 것이 아니다.

published `0.16.x`의 지원 metadata는 Node.js `^22.13.0 || ^24.0.0`, NestJS 10/11,
Prisma 6/7이다. 이전 `0.15.x`는 Node.js `>=20.19.0` metadata를 유지하지만 더는 보안 수정
대상이 아니다.

### 완료 — v0.16 기준 제공 capability

| 영역 | v0.16 상태 |
| --- | --- |
| HTTP tenant context | Header/Subdomain/JWT claim/Path/Composite 추출, lifecycle hook, `@CurrentTenant()`, `@BypassTenancy()` |
| 안전한 기본 동작 | fail-closed Prisma extension, `withoutTenant()`, shared model, tenant ID 자동 주입 |
| transaction | public Prisma API 기반 `tenancyTransaction()`과 deprecated compatibility 경로인 `interactiveTransactionSupport` |
| 비동기 전파 | Kafka, Bull/BullMQ, gRPC carrier와 inbound context interceptor |
| observability | tenancy event, optional OpenTelemetry, non-HTTP missing-context diagnostics |
| 비-DB resource | Redis/search resource key, Bull/BullMQ payload context propagation, tenant-aware response cache |
| CLI | Prisma schema 기반 `init`, 정적 drift `check`, single-table 및 manifest batch live PostgreSQL `doctor`, multi-schema SQL 생성 |
| testing | `@nestarc/tenancy/testing`과 실제 PostgreSQL/Redis/PgBouncer regression lane |
| 문서 | [공식 패키지 가이드](https://nestarc.dev/packages/tenancy/)와 [API reference](https://nestarc.dev/api/tenancy/) 운영 |

### 검증됨 — production evidence

아래 표는 published `v0.16.0`의 기능과 release gate를 함께 요약한다. 정확한 경계는
CHANGELOG와 현재 작업 계획을 따른다.

| 계약 | 검증 근거와 경계 |
| --- | --- |
| tenant ID 위조 방지 | HTTP opt-in `crossCheck`의 기본/명시적 `reject`는 primary·secondary 불일치를 차단한다. `log`는 관찰만 하며, secondary source 누락까지 차단하려면 `required: true`가 필요하다. 전파된 ID의 인증·권한 부여는 broker/application 책임이다. |
| RLS fail-closed | 실제 application role과 owner/FORCE RLS fixture에서 no-context 차단 및 tenant A/B 격리를 검증한다. superuser와 raw query를 자동으로 안전하게 만드는 보증은 아니다. |
| live DB doctor | catalog/role/policy/index 검사와 opt-in active isolation probe를 실제 PostgreSQL에서 검증한다. manifest v1 batch는 bounded concurrency, aggregate result, per-table partial error, deadline/signal cleanup을 제공한다. |
| transaction mode PgBouncer | PostgreSQL 16과 self-hosted PgBouncer transaction mode에서 Prisma 6/7의 backend 재사용·교체·동시성·commit·rollback·timeout·cleanup을 CI/release gate로 검증한다. managed/custom pooler 전체에 대한 일반 보증은 아니다. |
| package compatibility | NestJS 10/11 × Prisma 6/7 네 strict tarball consumer 조합과 root/cache/testing/bin package shape를 검증한다. |
| Nestarc ecosystem | API Keys → tenancy → RBAC → RLS/outbox → jobs → webhook 흐름을 검증한다. CI/release의 published-only tuple은 커밋된 lock과 registry source/integrity assertion을 사용하고, 미공개 tenancy candidate는 published sibling을 유지하는 명시적 local-artifact lane으로 분리한다. |

## 현재 유지보수 방향

다음 작업은 roadmap 문구가 아니라 현재 유지보수 계획의 작업 ID와 완료 조건으로 관리한다.

| 상태 | 방향 | 현재 결정 |
| --- | --- | --- |
| `완료` | `0.16.0` runtime 전환 | Node.js 22.13+/24 계약과 형제 패키지 compatibility evidence를 release gate로 적용했다. |
| `진행 중` | deprecated API 제거 | [migration ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md)에 따라 legacy event `request` 타입은 v0.16.0에서 제거했다. `interactiveTransactionSupport`는 v0.16.x까지 유지하고 v0.17.0에서 제거한다. |
| `완료` | doctor batch/구조화 | stable façade 분해와 manifest v1 catalog/active batch, aggregate E2E를 완료했다. |

## 보류·제안 — release promise 아님

| 상태 | 후보 | 승격에 필요한 근거 |
| --- | --- | --- |
| `보류` | TypeORM/Drizzle/MikroORM adapter | 검증된 사용자 수요, ORM별 transaction/RLS semantics, 독립 compatibility matrix와 유지보수 예산 |
| `제안` | schema-per-tenant / database-per-tenant | RLS로 해결되지 않는 구체적 규제·격리 요구, routing/migration/provisioning architecture와 운영 비용 평가 |
| `제안` | managed pooler / Data Proxy 지원 | 특정 provider와 설정을 선택한 재현 가능한 isolation·rollback·reuse·concurrency matrix |
| `제안` | WebSocket inbound boundary | 인증된 handshake/message/reconnect threat model과 실제 수요 |
| `제안` | health endpoint / tenant admin API | 운영 주체, 인증·권한 model, library와 application 책임 경계 |
| `제안` | 감사 로그 연동 | tenancy 내부에 감사 로그를 재구현하지 않는다. 형제 패키지 `@nestarc/audit-log`의 published contract와 opt-in integration을 별도 ecosystem 작업으로 검증한다. |

ORM adapter와 schema/database tenancy는 `v1.0.0`의 확정 범위가 아니다. v1은 새 기능 묶음보다
지원 범위, deprecated API migration, fail-closed/propagation 경계, package/release gate를 안정된 공개
계약으로 확정하는 별도 release decision이 먼저다.

## 릴리스 이력 요약

| release | 상태 | 핵심 결과 |
| --- | --- | --- |
| `v0.1.0`–`v0.3.0` | `완료` | core module, extractor/lifecycle, Prisma extension, bypass/transaction helper, CLI |
| `v0.4.0`–`v0.6.0` | `완료` | fail-closed/testing/events, HTTP 및 Kafka/Bull/gRPC propagation |
| `v0.7.0`–`v0.12.0` | `완료` | tenant cross-check/telemetry, framework-neutral types, API·CLI safety cleanup |
| `v0.13.0` | `완료` | tenant-aware response cache와 shared-cache opt-in |
| `v0.14.0` | `완료` | Prisma 7 primary support와 Prisma 6 compatibility lane |
| `v0.15.0` | `완료` | live DB doctor, Prisma 6/7 PgBouncer matrix, non-HTTP diagnostics/resources, Nestarc ecosystem E2E |
| `v0.16.0` | `완료` | Node.js 22.13+/24, raw event request type 제거, RPC tenant validator, fail-closed generated SQL/name/type 계약, doctor manifest batch, modern ecosystem gate |

새 후보의 상태나 목표 release를 정할 때는 이 표의 표현만 바꾸지 않는다. 먼저 현재 유지보수 계획에
작업 ID, 선행 조건, 검증 명령, 보증 범위와 비범위를 기록한 뒤 roadmap에 반영한다.
