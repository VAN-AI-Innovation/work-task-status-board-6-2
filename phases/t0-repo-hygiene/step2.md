# Step 2: deps-pinning

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 특히 `exceljs` import를 2파일로 제한하는 CRITICAL 규칙
- `docs/PLAN.md` — `A4`(ExcelJS가 20개월째 정체돼 있다), `A5`(zod가 전이 의존성이라 언제든 사라질 수 있다)
- `docs/ADR.md` — 기술 결정 이력
- `docs/TICKETS.md` — `## T0` 절의 「의존성 설치 + 버전 고정」과 완료 기준 5
- `package.json` · `next.config.ts` — 현재 상태
- 이전 step 산출물: `vitest.config.ts`, `src/lib/env-guard.ts`, `src/lib/env-guard.test.ts`

## 배경

두 가지 지뢰가 있다.

1. **`zod`가 `node_modules`에는 있지만 `package.json`에는 없다.** 다른 패키지가 끌고 온
   전이 의존성이라, 그 패키지가 버전을 올리거나 zod를 떼면 빌드가 조용히 깨진다 (`PLAN.md` A5).
2. **`exceljs@4.4.0`은 2024-12-20 이후 정체 상태다** (`PLAN.md` A4). 그래도 병합셀 읽기 +
   데이터 검증 드롭다운 쓰기를 한 라이브러리로 하는 대안이 없어서 유지하기로 확정했다.
   대신 **버전을 정확히 고정**해서 예기치 않은 이동을 막는다.

## 작업

### 1. 의존성 설치

아래를 `package.json`의 **직접 의존성(`dependencies`)** 에 추가하고 설치하라.

| 패키지 | 버전 | 용도 |
|---|---|---|
| `exceljs` | **정확히 `4.4.0`** (`^`·`~` 없이) | xlsx 읽기·쓰기 |
| `mammoth` | 최신 안정 | `.docx` → HTML 변환 |
| `zod` | 최신 안정 (v4) | 런타임 스키마 검증 |
| `chart.js` | 최신 안정 | 차트 |
| `react-chartjs-2` | 최신 안정 | 차트 React 래퍼 |
| `node-html-parser` | 최신 안정 | mammoth 출력 HTML 파싱 |

핵심 규칙:

- **`exceljs`는 `"exceljs": "4.4.0"`으로 적는다.** `^4.4.0`이 아니다. 이유: 정체된 패키지라
  갑작스러운 이동을 감지하지 못한 채 따라가면 안 된다 (`PLAN.md` A4, 완료 기준 5).
- **`zod`는 v4를 쓴다. v3와 API가 다르다** (`z.string().email()` → `z.email()` 등).
  이 step에서 zod 코드를 쓰지는 않지만, 설치 후 실제 설치된 메이저 버전을 확인해 두라.
- 나머지는 `^` 범위로 둔다. 여기까지가 확정된 판단이다.

### 2. `next.config.ts`에 `serverExternalPackages` 추가

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['exceljs'],
};
```

이유: exceljs는 Node 내장 모듈을 쓰는 오래된 의존성 트리(`unzipper`, `archiver`, `saxes` 등)를
갖고 있어서, 번들러가 서버 코드에 끌어넣으면 빌드가 깨진다. 서버 외부 패키지로 빼야 한다.

기존 주석(`/* config options here */`)은 지워도 된다. 다른 옵션을 추가하지 마라.

### 3. 설치 확인만 한다

이 step은 **설치와 고정까지**다. 어떤 패키지도 실제로 import하는 코드를 쓰지 마라.
`exceljs`를 쓰는 코드는 T2부터이며, `CLAUDE.md`가 import 위치를 두 파일로 못박고 있다:
`src/lib/sheet/workbook-reader.ts`(읽기)와 `src/lib/xlsx/assignment-writer.ts`(쓰기).

## Acceptance Criteria

```bash
npm run lint     # 경고·에러 없음
npm run build    # 컴파일 에러 없음 (serverExternalPackages 적용 확인)
npm test         # 기존 테스트 통과
```

추가로 아래가 모두 참이어야 한다:

```bash
node -e "const p=require('./package.json'); if(p.dependencies.exceljs!=='4.4.0') throw new Error('exceljs가 4.4.0으로 정확히 고정되지 않음: '+p.dependencies.exceljs)"
node -e "const p=require('./package.json'); for(const d of ['mammoth','zod','chart.js','react-chartjs-2','node-html-parser']) if(!p.dependencies[d]) throw new Error(d+'가 직접 의존성에 없음')"
grep -q "serverExternalPackages" next.config.ts
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ADR 기술 스택을 벗어나지 않았는가? (임의로 다른 라이브러리를 넣지 않았는가)
   - `package-lock.json`이 함께 갱신됐는가?
   - `src/` 아래에 새 파일이 생기지 않았는가? (이 step은 설정만 건드린다)
3. 결과에 따라 `phases/t0-repo-hygiene/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약. 설치된 zod 메이저 버전을 포함할 것"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `exceljs`를 `^4.4.0`으로 적지 마라. 이유: 완료 기준 5가 정확한 고정을 요구한다.
- `exceljs`·`mammoth`·`chart.js`를 import하는 코드를 쓰지 마라. 이유: T2 이후의 범위이고,
  `CLAUDE.md`가 `exceljs` import 위치를 두 파일로 제한한다.
- `next.config.ts`에 `serverExternalPackages` 외의 옵션을 추가하지 마라. 이유: 요청되지 않았다.
- 테이블에 없는 패키지를 설치하지 마라. 이유: T0 범위 In에 열거된 목록이 전부다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
