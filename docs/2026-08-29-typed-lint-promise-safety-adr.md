# ADR: 최소 typed lint Promise 안전성 gate

- 날짜: 2026-08-29 (Asia/Seoul)
- 상태: Accepted
- 작업: `TEN-M15B`

## 배경

기존 `npm run lint`는 type information 없이 `@eslint/js`와 typescript-eslint의
non-type-aware recommended rule 및 repository override를 실행한다.
`npm run typecheck`는 source와 repository-owned test의 TypeScript 의미를 검사하지만,
처리하지 않은 Promise나 Promise를 boolean/callback 위치에 잘못 전달하는 패턴은 막지 않는다.

typed preset 전체를 한 번에 적용하면 현재 테스트 helper와 mock에 큰 기계적 변경을 요구하고,
실제 안전성 gate와 스타일 변경을 한 작업에서 섞게 된다. 따라서 후보를 하나씩 실행한 뒤
Promise/async correctness에 직접 대응하는 최소 집합만 선택한다.

## Dry-run 증거

Node 24.11.1, ESLint 10.9.1, typescript-eslint 8.57.2, TypeScript 5.9.3에서
각 rule을 단독으로 `src/`와 repository-owned `test/`에 적용했다. 모든 typed run은
`tsconfig.typecheck.json`을 사용했고, 시간은 `/usr/bin/time -p`의 단일 wall-clock 측정값이다.
일반 `npm run lint` 기준선은 1.35초였다.

재현 가능한 단독 rule command 형식은 다음과 같다. `<rule>`만 후보 이름으로 바꾼다.

```bash
/usr/bin/time -p ./node_modules/.bin/eslint src/ test/ \
  --parser-options '{"project":"./tsconfig.typecheck.json"}' \
  --ignore-pattern 'test/compat/fixture/**' \
  --ignore-pattern 'test/package-consumer/fixture/**' \
  --rule '{"@typescript-eslint/<rule>":"error"}' \
  --no-color
```

| rule | 위반 | 최초 위반 | real |
| --- | ---: | --- | ---: |
| `@typescript-eslint/no-floating-promises` | 68 | `test/e2e/prisma-extension.e2e-spec.ts:76` | 2.71초 |
| `@typescript-eslint/no-misused-promises` | 0 | 없음 | 3.41초 |
| `@typescript-eslint/await-thenable` | 4 | `test/bull-tenant-propagator.spec.ts:63` | 2.22초 |
| `@typescript-eslint/require-await` | 74 | `test/cli/doctor-coverage.spec.ts:139` | 1.97초 |
| `@typescript-eslint/return-await` | 0 | 없음 | 2.13초 |
| `@typescript-eslint/promise-function-async` | 48 | `src/middleware/tenant.middleware.ts:56` | 5.89초 |

`no-floating-promises`를 `src/`에만 적용한 별도 dry-run은 위반 0건, 1.83초였다.
`no-misused-promises`의 `src/` 단독 dry-run도 위반 0건, 2.10초였다.

## 결정

별도 `eslint.typed.config.mjs`와 `npm run lint:typed` gate를 추가한다.

- `@typescript-eslint/no-misused-promises`를 `src/**/*.ts`와 repository-owned
  `test/**/*.ts`에 기본 옵션으로 적용한다. Promise를 조건식이나 void callback 자리에
  잘못 전달하는 신규 회귀를 막는다.
- `@typescript-eslint/no-floating-promises`를 우선 `src/**/*.ts`에 기본 옵션으로 적용한다.
  제품 코드의 처리하지 않은 Promise는 즉시 차단한다.
- typed parser는 `tsconfig.typecheck.json`만 사용한다. generated client와 독립 packed-consumer
  fixture는 자체 install/generate/typecheck lane을 가지므로 root typed lint에서도 제외한다.
- 기존 빠른 `npm run lint`는 유지하고, `lint:typed`를 같은 source matrix의 별도 필수 step으로
  실행한다. release publish는 reusable CI validation을 통해 같은 gate를 상속한다.

현재 `no-floating-promises` 위반 68건은 모두 test tree에 있다. 상당수는
`AsyncLocalStorage.run()`이나 middleware Promise를 callback-style Jest test에서 의도적으로
bridge한 코드이므로, 기계적으로 `void` 또는 `await`를 붙이면 test completion/error propagation
의미를 바꿀 수 있다. `TEN-M15B`에서는 자동 수정하지 않고 별도 후속 작업에서 한 건씩 분류한 뒤
test tree에도 rule을 확장한다.

구체적으로 `context.run(async ...)` 반환을 무시하는 49건과 `TenantMiddleware.use()` 반환을
무시하는 19건이다. 일부는 outer Promise로 resolve/reject를 직접 전달하지만 일부는 rejection
경로가 약하므로 blanket `allowForKnownSafeCalls`, file-wide disable, 기계적인 `void`로 예외 처리하지
않는다. 이 부채와 `await-thenable` 4건은 `TEN-M15D`에서 함께 추적한다.

## 제외한 후보

- `await-thenable`은 유용하지만 기존 test 4건을 바꾸므로 후속 test Promise 정리에서 다시 판단한다.
- `require-await`와 `promise-function-async`는 현재 mock/helper에 대규모 스타일 변경을 요구해
  이번 안전성 최소 집합에 포함하지 않는다.
- `return-await`는 현재 위반이 없지만 이번에 목표로 한 floating Promise/async callback misuse를
  직접 보완하지 않아 추가하지 않는다.
- typed preset 전체 적용, formatter 변경, autofix는 범위 밖이다.

## 결과

최종 구현에서 일반 `npm run lint` 3회는 real 1.80/1.21/1.23초(median 1.23초),
`npm run lint:typed` 3회는 3.23/3.13/3.08초(median 3.13초)였다. 별도 typed gate의
median runtime은 3.13초로 일반 lint보다 1.90초 느리고, CI source job의 15분 timeout 중
약 0.35%를 사용한다. 따라서 timeout을 늘리지 않고 일반 lint 다음에 typed lint를 필수
step으로 실행한다.

release publish는 reusable validation을 통해 같은 source gate를 상속한다. test tree의 floating
Promise와 non-Thenable await 정리는 `TEN-M15D`에서 별도로 수행한다.
