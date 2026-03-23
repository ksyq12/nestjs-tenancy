# @nestarc/tenancy — Claude Code 인수인계 문서

## 프로젝트 개요

NestJS용 PostgreSQL 멀티테넌시 모듈. Row Level Security(RLS) + Prisma 기반으로, `TenancyModule.forRoot()` 한 줄이면 멀티테넌시가 적용되는 것을 목표로 한다.

### 핵심 정보

| 항목 | 값 |
|------|-----|
| npm scope | `@nestarc` (npm org 생성 완료) |
| npm 패키지명 | `@nestarc/tenancy` |
| GitHub 레포명 | `nestjs-tenancy` (개인 계정) |
| 라이선스 | MIT |
| NestJS 호환 | v10, v11 |
| Prisma 호환 | v5, v6 |
| DB | PostgreSQL (RLS 기반) |

---

## 이 프로젝트를 만드는 이유

NestJS 생태계에서 멀티테넌시는 명확한 빈틈이다.

- 기존 `@needle-innovision/nestjs-tenancy`는 MongoDB/Mongoose 전용
- `nestjs-mtenant`은 Sequelize 전용
- **PostgreSQL + Prisma 조합**(현재 가장 인기 있는 NestJS 스택)을 지원하는 멀티테넌시 모듈은 0개
- SaaS를 만드는 NestJS 개발자들이 매번 처음부터 구현하고 있음

글로벌 타겟이며, 경쟁 진입장벽이 높아서 한번 자리잡으면 디팩토 표준이 될 수 있다.

---

## 기술 아키텍처 설계 방향

### 멀티테넌시 전략: PostgreSQL Row Level Security (RLS)

하나의 DB, 하나의 테이블에 `tenant_id` 컬럼을 두고, PostgreSQL이 쿼리 시점에 자동으로 행을 필터링하는 방식이다. DB 분리나 스키마 분리 대비 비용이 낮고 마이그레이션이 간편하다.

#### RLS 동작 원리

```sql
-- 1. 테이블에 RLS 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 2. 정책 생성: current_setting으로 세팅된 tenant_id만 접근 가능
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant')::text);

-- 3. 요청마다 tenant 세팅
SET app.current_tenant = 'tenant_123';
-- 이후 SELECT * FROM users → tenant_123의 데이터만 반환됨
```

### NestJS 모듈 동작 흐름

```
HTTP 요청 → Middleware (헤더에서 tenant_id 추출)
  → AsyncLocalStorage에 tenant_id 저장
    → Prisma $extends 또는 middleware에서 SET app.current_tenant 실행
      → 쿼리 → RLS가 자동 필터링
```

### 목표 사용자 경험 (API 디자인)

```typescript
// 1. 모듈 등록 — 한 줄
@Module({
  imports: [
    TenancyModule.forRoot({
      tenantExtractor: 'X-TENANT-ID',  // 헤더에서 추출
      // 또는 subdomain, jwt claim 등 지원
    }),
  ],
})
export class AppModule {}

// 2. forRootAsync도 지원
TenancyModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    tenantExtractor: config.get('TENANT_HEADER'),
  }),
})

// 3. 서비스에서 현재 tenant 접근
@Injectable()
export class SomeService {
  constructor(private readonly tenancy: TenancyService) {}

  doSomething() {
    const tenantId = this.tenancy.getCurrentTenant();
    // Prisma 쿼리는 자동으로 RLS 적용됨
  }
}

// 4. 특정 라우트에서 테넌시 우회 (관리자용)
@BypassTenancy()
@Get('admin/all-users')
getAllUsers() { ... }
```

---

## 구현 로드맵

### Phase 1 — MVP (v0.1.0)

핵심 기능만. npm 배포 가능 상태까지.

- [ ] `TenancyModule.forRoot()` / `forRootAsync()` 구현
- [ ] 헤더 기반 tenant 추출 미들웨어
- [ ] `TenancyService` — 현재 tenant 조회 (AsyncLocalStorage 기반)
- [ ] Prisma 확장 — 쿼리 전에 `SET app.current_tenant` 자동 실행
- [ ] `@CurrentTenant()` 파라미터 데코레이터
- [ ] 기본 에러 처리 (tenant 누락 시 403)
- [ ] 유닛 테스트
- [ ] README 작성

### Phase 2 — 실용성 강화 (v0.2.0)

- [ ] Subdomain 기반 tenant 추출
- [ ] JWT claim 기반 tenant 추출
- [ ] `@BypassTenancy()` 데코레이터 (관리자 기능용)
- [ ] Tenant 유효성 검증 훅 (DB에서 tenant 존재 확인)
- [ ] E2E 테스트 (실제 PostgreSQL + Docker)

### Phase 3 — 프로덕션 레디 (v1.0.0)

- [ ] 커넥션 풀링 최적화
- [ ] RLS 정책 자동 생성 CLI 도구
- [ ] Prisma migration 연동 가이드
- [ ] 다중 DB 전략 지원 (schema separation 옵션)
- [ ] 공식 문서 사이트

---

## 파일 구조

```
nestjs-tenancy/
├── package.json
├── tsconfig.json / tsconfig.build.json
├── jest.config.ts
├── docker-compose.yml             # E2E용 PostgreSQL
├── README.md
├── docs/handover.md               # 이 문서
├── src/
│   ├── index.ts                   # 배럴 export
│   ├── tenancy.module.ts          # DynamicModule (forRoot/forRootAsync)
│   ├── tenancy.constants.ts       # 인젝션 토큰, UUID 정규식
│   ├── interfaces/
│   │   ├── tenancy-module-options.interface.ts
│   │   └── tenant-extractor.interface.ts
│   ├── services/
│   │   ├── tenancy-context.ts     # AsyncLocalStorage 래퍼
│   │   └── tenancy.service.ts     # 공개 서비스
│   ├── middleware/
│   │   └── tenant.middleware.ts   # 요청에서 tenant 추출 + 검증
│   ├── guards/
│   │   └── tenancy.guard.ts       # HTTP-only tenant 강제
│   ├── decorators/
│   │   ├── current-tenant.decorator.ts
│   │   └── bypass-tenancy.decorator.ts
│   ├── extractors/
│   │   └── header.extractor.ts    # 헤더 기반 추출
│   └── prisma/
│       └── prisma-tenancy.extension.ts  # Prisma $extends (set_config + batch tx)
├── test/                          # 유닛 테스트 (38개)
└── test/e2e/                      # E2E 테스트 (12개, Docker + PostgreSQL)
```

---

## 핵심 구현 포인트 (Claude Code 작업 시 참고)

### 1. AsyncLocalStorage 사용

NestJS의 REQUEST scope는 성능 이슈가 있으므로, `AsyncLocalStorage`를 사용하여 request-scoped tenant context를 관리한다. `nestjs-cls` 패키지를 참고하되, 의존성으로 추가하지 말고 자체 구현하는 것을 권장.

```typescript
import { AsyncLocalStorage } from 'async_hooks';

const tenantStorage = new AsyncLocalStorage<{ tenantId: string }>();
```

### 2. Prisma 확장 방식

Prisma Client Extensions (`$extends`)를 활용하여 모든 쿼리 전에 RLS 컨텍스트를 세팅한다.

```typescript
const prismaWithTenant = prisma.$extends({
  query: {
    $allOperations({ args, query }) {
      const tenantId = tenantStorage.getStore()?.tenantId;
      if (tenantId) {
        return prisma.$transaction([
          prisma.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${tenantId}'`),
          query(args),
        ]).then(([, result]) => result);
      }
      return query(args);
    },
  },
});
```

> ⚠️ SQL 인젝션 주의: `tenantId`는 반드시 검증/이스케이프 필요

### 3. NestJS DynamicModule 패턴

`@nestjs/jwt`, `@nestjs/throttler` 등 공식 모듈의 패턴을 따른다.

```typescript
@Module({})
export class TenancyModule {
  static forRoot(options: TenancyModuleOptions): DynamicModule { ... }
  static forRootAsync(options: TenancyModuleAsyncOptions): DynamicModule { ... }
}
```

---

## 경쟁/참고 자료

| 패키지/자료 | 설명 | 참고 포인트 |
|-------------|------|------------|
| `@needle-innovision/nestjs-tenancy` | MongoDB 전용 멀티테넌시 | forRoot/forRootAsync 패턴, Validator 인터페이스 |
| `nestjs-mtenant` | Sequelize 전용 | 데코레이터 API, tenancy scope 관리 |
| `nestjs-cls` | AsyncLocalStorage NestJS 래퍼 | CLS 구현 패턴 참고 |
| Fabian Isele 블로그 | NestJS + PostgreSQL RLS 가이드 | RLS + async_hooks 구현 예시 |
| `nestjs-otel` | 성공한 NestJS 커뮤니티 패키지 | README 구조, 배포 전략 참고 |

---

## 브랜드/배포 전략

- `@nestarc` scope 아래 첫 번째 패키지
- 향후 `@nestarc/audit-log`, `@nestarc/feature-flag` 등으로 확장 가능
- 기존 개인 패키지 `nestjs-safe-response`와는 독립적
- GitHub 레포에 `nestjs-tenancy`라는 이름을 사용해 검색 최적화
- README는 영어로 작성 (글로벌 타겟)

---

## 즉시 시작할 작업 순서

1. `tsconfig.json`, `.gitignore`, `jest.config.ts`, `.eslintrc.js` 생성
2. `src/interfaces/` — `TenancyModuleOptions`, `TenantExtractor` 인터페이스 정의
3. `src/tenancy.module.ts` — `forRoot()` / `forRootAsync()` 스캐폴딩
4. `src/providers/tenancy.service.ts` — AsyncLocalStorage 기반 tenant context
5. `src/middleware/tenant.middleware.ts` — 헤더에서 tenant 추출
6. `src/providers/prisma-tenancy.extension.ts` — Prisma 확장
7. `src/decorators/` — `@CurrentTenant()`, `@BypassTenancy()`
8. `src/index.ts` — 배럴 export
9. 유닛 테스트 작성
10. README.md 작성
11. npm 배포 테스트 (`npm publish --dry-run`)