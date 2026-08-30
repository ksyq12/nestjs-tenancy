# TEN-M24 — Nest 12, Prisma 8, managed pooler 조사 스파이크

- 조사일: 2026-08-30 (Asia/Seoul)
- 기준 HEAD: `d74841bd9c72c7630b2b8efb830a270fa2908407`
- 브랜치: `codex/ten-m24-next-major-pooler-spike`
- 결론: `BLOCKED`
- 범위: 공식 문서와 npm registry 계약 조사, 격리된 Nest 12 consumer spike
- 비범위: production peer 확대, Prisma 8 RC 지원, provider 전체에 대한 일반화

## 1. 결론

Nest 12는 안정판과 공식 11→12 migration guide가 공개되어 독립적인 호환성 작업을
검토할 시점이다. 그러나 현재 패키지는 단순 peer range 확대만으로 Nest 12를 지원할 수
없다. Nest 12의 ESM-only package와 이 패키지의 CommonJS declaration 사이에서 strict
consumer typecheck가 실패하고, `@nestjs/common/interfaces` deep import도 Nest 12 export
계약과 맞지 않는다.

Prisma 8은 웹 문서에서 current release로 소개되지만, 2026-08-30의 공개 npm registry에서
`prisma@latest`는 `8.0.0-rc.12`, `@prisma/orm-postgres@latest`는 `8.0.0-rc.8`이다.
기존 `@prisma/client`는 `7.10.0`이 최신 안정판이다. Prisma 8의 RLS authoring,
middleware, transaction API는 유망하지만 production peer로 선언할 안정판 계약으로
판정하지 않는다.

managed pooler 조사 대상은 Supabase shared Supavisor transaction mode(port 6543)로
구체화했다. 다만 현재 환경에는 managed endpoint 자격 증명이 없고 Prisma 8 runtime도
RC이므로 provider real-DB spike는 실행하지 않았다. 로컬 PgBouncer 성공을 Supavisor
지원으로 일반화하지 않는다.

따라서 TEN-M24는 production code와 peer range를 바꾸지 않고 `BLOCKED`로 종료한다.

## 2. 공식 계약 스냅샷

| 대상 | 공식 상태 | 저장소 판정 | 근거 |
| --- | --- | --- | --- |
| Nest 12 | `@nestjs/core@12.0.1`이 npm `latest`; 11→12 migration guide 공개 | upstream stable, 현재 패키지는 unsupported | [Nest migration guide](https://docs.nestjs.com/migration-guide), [@nestjs/core npm](https://www.npmjs.com/package/@nestjs/core) |
| Nest 12 module format | core packages가 ESM-only; application runtime은 Node 20.19+ 또는 22.12+ | 현재 CommonJS dist/declaration과의 interop 설계 필요 | [Nest migration guide](https://docs.nestjs.com/migration-guide), [core package manifest](https://github.com/nestjs/nest/blob/master/packages/core/package.json) |
| Nest optional peers | `@nestjs/cache-manager@12.0.0`, `@nestjs/event-emitter@12.0.0`이 Nest 12 peer를 선언 | 현재 optional peer `^2 || ^3` 범위로는 Nest 12 profile을 표현하지 못함 | npm registry의 각 package manifest |
| Prisma 8 distribution | docs/changelog는 Prisma 8을 current/`latest` 전환으로 설명하지만 registry의 `prisma@latest`는 `8.0.0-rc.12` | stable 진입 조건 미충족 | [Prisma 8 overview](https://www.prisma.io/docs/orm), [2026-08-28 changelog](https://www.prisma.io/changelog/2026-08-28), npm registry dist-tag |
| Prisma 8 migration | PostgreSQL side-by-side guide가 있으나 예시는 `8.0.0-rc.6`/`rc.4`로 검증됨 | final migration contract로 사용하지 않음 | [Prisma 7→8 PostgreSQL guide](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) |
| Prisma 8 transaction | `db.transaction()`의 `tx` 호출이 같은 transaction connection을 사용한다고 명시 | explicit tenant transaction 재설계 후보; 현재 API와 호환되지 않음 | [transactions/runtime reference](https://docs.prisma.io/docs/orm/v8/reference/transactions-and-runtime) |
| Prisma 8 middleware/RLS | runtime middleware와 RLS policy authoring 문서는 존재; Supabase extension은 experimental | 자동 per-query GUC transaction 경로의 stable 보증은 확인하지 못함 | [middleware guide](https://www.prisma.io/docs/orm/middleware/how-middleware-works), [extensions guide](https://docs.prisma.io/docs/orm/extensions/using-extensions), [RLS changelog](https://www.prisma.io/changelog/2026-07-17) |
| Supavisor transaction mode | shared pooler port 6543; transaction pooling; prepared statements 미지원 | 구체적인 managed provider/config로 선택했으나 repository support는 unknown | [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres), [prepared statements guide](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL) |

`npm view`로 확인한 exact snapshot은 다음과 같다.

```text
@nestjs/core             latest=12.0.1, type=module, engines.node=>=20
@nestjs/common           latest=12.0.1, type=module
@nestjs/testing          latest=12.0.1, type=module
@nestjs/platform-express latest=12.0.1, type=module
@nestjs/cache-manager    latest=12.0.0, Nest peer includes ^12.0.0
@nestjs/event-emitter    latest=12.0.0, Nest peer includes ^12.0.0
prisma                   latest=8.0.0-rc.12, prev=7.10.0, engines.node=>=22.18.0
@prisma/client           latest=7.10.0
@prisma/orm-postgres     latest=8.0.0-rc.8
```

## 3. 진입 조건 판정

| 진입 조건 | 판정 | 설명 |
| --- | --- | --- |
| Nest 12 또는 Prisma 8 안정판과 migration guide | 충족 | Nest 12.0.1과 11→12 guide가 공개됐다. Prisma 8은 별도로 아직 RC다. |
| Prisma RLS/transaction extension 공식 경로가 안정 계약 | 미충족 | 문서화된 새 API는 존재하지만 공개 runtime package가 RC이고 Supabase extension도 experimental이다. 기존 Client Extension과 호환되는 안정 경로도 아니다. |
| managed pooler provider/config 구체화 | 충족 | Supabase shared Supavisor transaction mode, port 6543를 선택했다. |
| managed provider real-DB 실행 자격 | 미충족 | 환경에 Supabase direct/admin URL과 restricted app-role pooler URL이 없다. |

두 번째 필수 조건과 real-DB 실행 자격이 없으므로 Prisma 8 또는 managed pooler 지원
구현으로 진행하지 않는다.

## 4. Nest 12 isolated consumer spike

repository의 production manifest를 바꾸지 않고 다음 방식으로 확인했다.

1. 현재 package를 build/pack했다.
2. 임시로 추출한 package manifest의 Nest common/core peer에만 `^12.0.0`을 추가했다.
3. 격리 consumer에 Nest `12.0.1`, Prisma Client `7.10.0`, TypeScript `5.9.3`을
   exact install했다.
4. `--strict-peer-deps`, `skipLibCheck=false`를 유지했다.

첫 CommonJS consumer의 결과:

```text
npm install --strict-peer-deps: PASS (30 packages)
npm ls --depth=0: PASS
npm run typecheck: FAIL
TS1541: ESM type-only import requires a resolution-mode attribute
TS1479: CommonJS import cannot statically import @nestjs/testing ESM
```

consumer 자체를 ESM으로 전환한 두 번째 결과:

```text
npm install --strict-peer-deps: PASS (49 packages)
npm ls --depth=0: PASS
npm run typecheck: FAIL
TS1541/TS1479: @nestarc/tenancy의 CommonJS declarations가 Nest ESM을 import
TS2307: @nestjs/common/interfaces deep import를 Nest 12 export map에서 해석하지 못함
```

두 번째 실패는 consumer 설정만으로 해결할 문제가 아니다. 이 package의 build/package
format과 declaration import를 함께 설계해야 한다. typecheck가 실패한 상태에서 build,
runtime smoke, real-DB를 억지로 진행하지 않았다.

## 5. Prisma 8 영향

Prisma 8은 기존 `PrismaClient` 생성물과 `$extends` query component의 다음 minor가 아니다.
contract JSON/TypeScript artifact, `@prisma/orm-postgres` runtime, composable query DSL,
runtime middleware로 중심 모델이 바뀐다. 현재 public API인
`createPrismaTenancyExtension()`은 `@prisma/client/extension` 타입과 `$transaction()`
형상을 노출하므로 Prisma 8 package를 peer range에 추가하는 것으로 호환되지 않는다.

공식 transaction reference가 보장하는 같은-connection `db.transaction(tx => ...)`는
`set_config(..., true)` 기반 격리를 재설계할 좋은 후보지만, 다음은 아직 증명되지 않았다.

- middleware가 한 model query와 tenant GUC 설정을 원자적인 같은 transaction으로 감싸는 공식 recipe
- no-context fail-closed와 raw SQL 경계
- transaction pooler에서 commit/rollback/timeout 후 GUC cleanup
- Prisma 7 public API를 보존하면서 Prisma 8 adapter를 제공할 package boundary
- RLS contract authoring과 이 package가 생성하는 policy/doctor contract의 ownership 관계

Prisma 8 final이 registry에 공개되기 전에는 RC spike 결과를 production 지원 근거로 쓰지 않는다.

## 6. Supavisor 검증 계약

향후 managed spike는 다음 두 connection을 별도 secret으로 받아야 한다.

- direct/admin connection: schema, role, policy setup과 catalog/active doctor용
- restricted application connection: shared Supavisor transaction mode(port 6543), TLS,
  prepared statements 비활성화

실행할 최소 corpus:

1. application role + FORCE RLS의 tenant A/B/no-context 격리
2. explicit transaction의 commit, rollback, timeout, custom setting key
3. backend 재사용/교체와 동시성에서 tenant GUC 누출 없음
4. transaction 종료 후 `current_setting(..., true)` cleanup
5. doctor catalog와 opt-in active probe; secret/tenant value redaction
6. provider connection/pool exhaustion 오류의 분류와 cleanup

Supabase 문서는 transaction mode에서 prepared statements를 지원하지 않는다고 명시한다.
Prisma 6 native engine의 `pgbouncer=true`와 Prisma 7/8 `pg` runtime의 unnamed statement
동작을 같은 설정으로 간주하지 않고 각각 확인해야 한다.

## 7. 후속 implementation 후보와 matrix 비용

### `TEN-M25` — Nest 12 ESM/package compatibility

Nest 12 지원은 upstream stable이므로 별도 구현 후보로 타당하다. 다만 단순 peer update가
아니며 다음이 필요하다.

- CommonJS/ESM package strategy와 exports/declaration 설계
- `@nestjs/common/interfaces` deep import 제거
- Nest 10/11 CommonJS consumer와 Nest 12 ESM consumer 동시 보존
- optional peers의 Nest 12-compatible major 조사 및 runtime smoke
- strict package-shape/root/cache/testing/bin 검증

현재 4개 Nest 10/11 × Prisma 6/7 strict consumer를 6개로 늘리면 +2 lane이다.
여기에 CJS/ESM package consumer 2개와 Nest 12 optional-peer profile 1개가 필요하다.
DB/PgBouncer lane은 Prisma data path가 같다는 근거를 유지할 수 있으면 중복하지 않고,
Nest 12 + Prisma 7 direct DB 최소 lane 하나만 추가한다.

Prisma 8 지원은 final package와 stable runtime/RLS contract가 확인된 뒤 새 ID를 부여한다.
Supavisor 지원도 provider 자격 증명과 위 corpus를 실행할 세션이 준비된 뒤 별도 ID로
승격한다. 둘을 TEN-M25에 섞지 않는다.

## 8. 재검토 조건

정기 재검토일은 **2026-09-30**이다. 다음 조건이 먼저 발생하면 그날 바로 재개한다.

1. `npm view prisma dist-tags version --json`의 `latest`가 prerelease가 아닌 `8.x`다.
2. `@prisma/orm-postgres`도 같은 stable release line을 제공한다.
3. PostgreSQL upgrade guide가 RC가 아닌 final exact version으로 검증되어 있다.
4. RLS runtime context를 같은 transaction connection에 적용하는 supported public 경로가
   공식 문서에 명시되거나, explicit transaction-only 설계를 채택할 결정자가 지정된다.
5. Supabase direct/admin URL과 restricted app-role Supavisor transaction URL을 제공할
   운영 소유자가 지정된다.

재개 첫 명령:

```bash
npm view prisma dist-tags version engines --json
npm view @prisma/client dist-tags version engines --json
npm view @prisma/orm-postgres dist-tags version engines --json
```

그 뒤 공식 migration/RLS/transaction 문서의 final-version 표기를 다시 확인하고,
provider secret이 준비된 별도 격리 환경에서 real-DB corpus를 실행한다.
