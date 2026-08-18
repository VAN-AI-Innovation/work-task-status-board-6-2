# Step 5: alert-rules

## 읽어야 할 파일

- `CLAUDE.md` — 도메인 규칙
- `docs/TICKETS.md` — `## T4` 완료 기준 **6**(알림 4종), `## T6` 완료 기준 2
- `docs/PLAN.md` — 「6. 집계·판정」의 마감 임박·장기 미갱신·담당자 미지정 규칙,
  「엣지 케이스 처리 방침」의 "마감일이 없는 업무", 「여정에서 도출된 설계 요구」 3번,
  `UC-12`·`UC-13`
- T2 산출물: `src/types/sheet.ts`의 `SlaRuleEntry`(`label`·`days`. **`stageKey`가 없다**)
- T3 산출물: `src/lib/sheet/stage-unpivot.ts`(`ParsedStage.slaDays`가 어디서 오는지)
- step 0~2 산출물: `TaskStage`, `task-derive.ts`

## 배경

알림 패널(`UC-12`·`UC-13`)의 내용물이다. **4종이 완료 기준**이다:
마감 임박 / 장기 미갱신 / 담당자 미지정 / **기한 미설정**.

네 번째가 눈에 안 띄는데, 이건 여정을 그려보고 나서 추가된 항목이다
(`PLAN.md` 「여정에서 도출된 설계 요구」 3번). 마감일이 없는 업무는 `isOverdue` 판정에서
조용히 빠지므로, 별도 알림이 없으면 **영원히 아무 화면에도 안 뜬다.**

판정 자체는 step 2가 이미 다 했다. 이 step은 **플래그를 알림 목록으로 바꾸고,
마감 임박에 단계 SLA를 얹는다.**

## 작업

### 1. `src/lib/domain/alert-rules.ts` — 테스트를 **먼저** 쓴다

```ts
export type AlertKind =
  | 'due_soon'       // 마감 임박          (완료 기준 6 ①)
  | 'stale'          // 장기 미갱신        (완료 기준 6 ②)
  | 'no_owner'       // 담당자 미지정      (완료 기준 6 ③)
  | 'no_due_date'    // 기한 미설정        (완료 기준 6 ④)
  | 'unknown_owner'; // 구성원 목록에 없는 담당자 (UC-12. 4종에는 포함되지 않는 보조 신호)

export interface Alert {
  kind: AlertKind;
  taskId: string;
  teamKey: TeamKey;
  severity: 'warn' | 'danger';
  /** `due_soon`이면 남은 일수, `stale`이면 미갱신 일수. 나머지는 null */
  days: number | null;
  /** 단계 SLA 때문에 뜬 알림이면 그 단계의 `stageKey`. 태스크 마감 기준이면 null */
  stageKey: string | null;
}

export interface AlertContext extends DeriveContext {
  flags?: Map<string, TaskFlags>;
  /** 설정 탭 SLA 표. 라벨→일수 (`SlaRuleEntry[]`) */
  slaRules?: readonly SlaRuleEntry[];
}

export function collectAlerts(
  tasks: readonly Task[],
  stages: readonly TaskStage[],
  ctx: AlertContext
): Alert[];
```

### 2. 알림 규칙

1. `no_owner` — `flags.hasNoOwner`. `severity: 'warn'`. `done`·`cancelled`는 **제외**한다
   (끝난 업무의 담당자를 지금 찾을 이유가 없다).
2. `no_due_date` — `flags.hasNoDueDate`. `severity: 'warn'`.
3. `stale` — `flags.isStale`. `days`는 미갱신 일수. `severity: 'warn'`.
4. `unknown_owner` — `flags.hasUnknownOwner`. `severity: 'warn'`. `done`·`cancelled` 제외.
5. `due_soon` — 두 경로가 있고 **둘 다** 만든다.
   - **태스크 경로**: `flags.isDueSoon` (D-3 기본). `stageKey: null`, `days: flags.dday`.
   - **단계 경로**: 단계에 `slaDays`가 있고 `actualDate === null`이고 `plannedDate !== null`일 때,
     `daysBetween(today, plannedDate) <= slaDays`면 알림. `stageKey`는 그 단계,
     `days`는 `plannedDate`까지 남은 일수. 소속 태스크가 `done`·`cancelled`면 만들지 않는다.
   - **`severity`는 `days < 0`(이미 지남)이면 `'danger'`, 아니면 `'warn'`.**
   - 같은 태스크에서 태스크 경로 1건 + 단계 경로 N건이 동시에 나올 수 있다. 접지 마라 —
     "어느 단계가 늦었는지"가 알림의 값어치다.
6. `ctx.slaRules`는 **참고만** 한다. `SlaRuleEntry`에는 `stageKey`가 없고(T2의 결정),
   `TaskStage.slaDays`는 T3의 `STAGE_GROUPS`가 이미 넣어뒀다. **단계에 `slaDays`가 이미 있으면
   그 값을 쓰고, 없을 때만** `slaRules`에서 `stage.stageLabel`과 **정확히 일치**하는 라벨을 찾는다.
   부분 일치·포함 검색을 쓰지 마라 (`편집팀 컨셉 공유`와 `편집팀 컨셉 승인`이 섞인다).
7. **알림에 이름·업무명·셀 값을 담지 마라.** `taskId`만 담고 화면이 태스크를 다시 조회한다.
   민감 키 마스킹은 응답 계층(T5·T6)의 일이며, 알림 객체가 그 통제를 우회하면 안 된다.
8. 정렬은 결정적이어야 한다: `severity`(danger 먼저) → `kind`(위 선언 순서) →
   `days` 오름차순(null은 뒤) → `taskId` 사전순.
9. 순수 함수다. 시간을 읽지 않고 입력을 고치지 않는다.

### 3. 테스트 케이스 (`src/lib/domain/alert-rules.test.ts`)

1. **4종이 각각 최소 1건씩 나오는 입력**을 만들고 `kind` 집합이 4종을 전부 포함함을 단언
   (완료 기준 6의 직접 증명)
2. `done`인 업무는 `no_owner`·`no_due_date`·`unknown_owner`를 만들지 않는다
3. `stale` 알림의 `days`가 실제 미갱신 일수와 같다
4. 단계 SLA 경로: `slaDays: 2`, `plannedDate`가 오늘+1, `actualDate: null` → `due_soon` 1건,
   `stageKey`가 그 단계
5. **`actualDate`가 채워진 단계는 알림을 만들지 않는다** (이미 끝난 단계)
6. `plannedDate`가 어제인 단계 → `severity: 'danger'`, `days` `-1`
7. 소속 태스크가 `취소`면 단계 알림도 안 나온다
8. `slaDays`가 null인 단계 + `slaRules`에 `stageLabel`과 같은 라벨이 있으면 그 일수를 쓴다
9. **`slaRules`에 비슷한 라벨(`편집팀 컨셉 공유` / `편집팀 컨셉 승인`)이 둘 있어도
   정확히 일치하는 것만 쓴다**
10. 같은 태스크에서 태스크 경로와 단계 경로 알림이 **둘 다** 나온다
11. **알림 객체에 업무명·담당자 문자열이 없다** (`JSON.stringify`에 해당 문자열 부재)
12. 정렬이 결정적이다 — 입력 순서를 뒤집어도 결과 배열이 같다
13. 빈 입력 → 빈 배열, 예외 없음
14. 픽스처 통합: `parseWorkbook` 결과로 `today: '2026-07-25'`에서 알림을 뽑아
    종류별 건수를 실측해 단언한다

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/alert-rules.test.ts

# 시간을 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/alert-rules.ts ; test $? -eq 1

# 판정을 다시 구현하지 않았다 — task-derive를 import한다 (출력이 있어야 함)
grep -n "task-derive" src/lib/domain/alert-rules.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs\|@supabase" src/lib/domain/alert-rules.ts ; test $? -eq 1

# 회귀
npx vitest run src/lib/sheet src/lib/domain

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 4종(마감 임박 / 장기 미갱신 / 담당자 미지정 / **기한 미설정**)이 전부 나오는가?
   - `hasNoOwner`·`isStale` 등을 `task-derive`에서 가져다 쓰는가, 다시 구현했는가?
   - 알림에 이름·업무명이 새어 나갈 경로가 없는가?
   - SLA 라벨 매칭이 부분 일치가 아닌가?
3. `phases/t4-store-domain/index.json`의 step 5를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 픽스처 실측 알림 종류별 건수와 기준 날짜를 포함하라.

## 금지사항

- `overdue`(지연)를 알림 종류로 추가하지 마라. 이유: 완료 기준의 4종에 없고, 지연은 KPI·행 강조로 다룬다.
- 알림 발송(디스코드 웹훅 등)을 만들지 마라. 이유: T10의 범위다.
- 알림 객체에 담당자 이름·업무명·`extras` 값을 담지 마라. 이유: 응답 계층의 마스킹을 우회한다.
- 같은 태스크의 알림을 하나로 접지 마라. 이유: 어느 단계가 늦었는지가 값어치다.
- `isDueSoon`·`isStale`·`hasNoOwner`를 다시 구현하지 마라. 이유: 판정이 두 곳이 되면 갈라진다.
- SLA 라벨을 부분 일치로 찾지 마라. 이유: `컨셉 공유`와 `컨셉 승인`이 섞인다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
