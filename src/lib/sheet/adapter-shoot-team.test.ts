/**
 * 픽스처(`sample-workbook.xlsx`)의 `02_촬영·기획팀`을 통합 검증한다.
 *
 * 이 탭의 최우선 검증은 **유령 행 25건**이다 (PLAN.md E1). 신원 판정이 수식 셀을 보면
 * 태스크가 1건이 아니라 26건이 되고, 1900년 기한의 "지연" 업무 25건이 대시보드를 덮는다.
 *
 * 밴드는 `detectTab`에서 꺼낸다 — 파이프라인(step 8)이 넘길 값과 같은 경로여야 한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { FIELD_MAP, STAGE_GROUPS, parseShootTeamTab } from '@/lib/sheet/adapter-shoot-team';
import { detectTab } from '@/lib/sheet/tab-detector';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { ParseWarning } from '@/types/sheet';
import type { ParsedTask, TabParseResult } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const BASE_YEAR = 2026;

/** 시트 컬럼 수. 헤더 71개가 A~BS에 붙는다 */
const COLUMN_COUNT = 71;
/** `idHeader`(업무ID)와 `coOwnerHeader`(공동 담당자) — 필드 맵 밖에서 extras에서 빠진다 */
const NON_FIELD_EXCLUDED = 2;

/** 유령 행 0-based 10~34 → 1-based 11~35 */
const GHOST_ROW_FIRST = 11;
const GHOST_ROW_LAST = 35;

let result: TabParseResult;

beforeAll(async () => {
  const workbook = await readWorkbook(readFileSync(FIXTURE));
  const sheet = workbook.sheets.find((s) => s.name === '02_촬영·기획팀');
  if (!sheet) throw new Error('픽스처에 02_촬영·기획팀이 없다');

  const detection = detectTab(sheet);
  expect(detection.kind).toBe('shoot_team');
  expect(detection.matches[0].band).toEqual({ groupRow: 7, labelRow: 8 });

  result = parseShootTeamTab(sheet, detection.matches[0].band, { baseYear: BASE_YEAR });
});

const only = (): ParsedTask => {
  const [task] = result.tasks;
  if (!task) throw new Error('태스크가 없다');
  return task;
};

describe('parseShootTeamTab — 유령 행 25건 (E1, 최우선)', () => {
  it('태스크가 정확히 1건이다', () => {
    // 26건이면 신원 판정이 수식 셀을 보고 있다는 뜻이다.
    expect(result.tasks).toHaveLength(1);
    expect(only().sourceRowIndex).toBe(10);
  });

  it('유령 행에서 생긴 경고가 0건이다', () => {
    // 25건이 25개의 잡음이 되면 진짜 경고가 묻힌다.
    const fromGhost = result.warnings.filter(
      (w) => w.row !== undefined && w.row >= GHOST_ROW_FIRST && w.row <= GHOST_ROW_LAST
    );
    expect(fromGhost).toEqual([]);
  });

  it('1900-01-01·1899-12-31이 날짜 필드에 하나도 없다', () => {
    for (const task of result.tasks) {
      for (const value of [task.dueAt, task.assignedAt, task.nextActionDue]) {
        expect(value).not.toBe('1900-01-01');
        expect(value).not.toBe('1899-12-31');
      }
    }
  });
});

describe('parseShootTeamTab — 탭 결과', () => {
  it('teamKey가 shoot이고 목표 지표·브리핑은 비어 있다', () => {
    expect(result.sheet).toBe('02_촬영·기획팀');
    expect(result.teamKey).toBe('shoot');
    expect(result.goalMetrics).toEqual([]);
    expect(result.briefingLines).toEqual([]);
    expect(only().teamKey).toBe('shoot');
  });

  it('stages가 빈 배열이다 — 1차 완화안이 적용됐다', () => {
    // 티켓 T3「리스크·미결」: 촬영팀은 공통 필드 + extras 전량 보존만 한다.
    expect(STAGE_GROUPS).toEqual([]);
    expect(only().stages).toEqual([]);
  });

  it('공통 필드가 채워진다', () => {
    const task = only();

    expect(task.title).toBe('[샘플] 브랜드 필름');
    expect(task.ownerNameRaw).toBe('기획자1');
    expect(task.priority).toBe('높음');
    expect(task.status).toBe('진행 중');
    expect(task.progress).toBe(40); // 0.4 + `0%` 서식 (E3)
    expect(task.assignedAt).toBe('2026-07-20');
    expect(task.dueAt).toBe('2026-08-05');
    expect(task.riskStatus).toBe('정상');
    expect(task.nextAction).toBe('출연자 섭외 확정');
    expect(task.nextActionOwner).toBe('기획자2');
    expect(task.nextActionDue).toBe('2026-07-28');
  });
});

describe('parseShootTeamTab — 자연키와 공동 담당자', () => {
  it('sourceKey가 업무ID 값이다 — slug 규칙으로 떨어지지 않았다', () => {
    expect(only().sourceKey).toBe('[샘플] SH-001');
    expect(only().sourceKey).not.toContain('::');
  });

  it('coOwnerNames가 배열이다', () => {
    expect(Array.isArray(only().coOwnerNames)).toBe(true);
    expect(only().coOwnerNames).toEqual(['기획자2']);
  });
});

describe('parseShootTeamTab — extras와 raw (완료 기준 3)', () => {
  it('raw에 71컬럼이 모두 있다', () => {
    expect(Object.keys(only().raw)).toHaveLength(COLUMN_COUNT);
  });

  it('extras 키 개수가 71 − (FIELD_MAP + 업무ID + 공동 담당자)다', () => {
    // 상수를 박지 않는다. FIELD_MAP이 늘면 이 식이 같이 움직여야 한다.
    expect(Object.keys(only().extras)).toHaveLength(
      COLUMN_COUNT - FIELD_MAP.length - NON_FIELD_EXCLUDED
    );
  });

  it('촬영 담당자가 extras에 남아 있다', () => {
    // 신원 판정에 썼다는 이유로 지우면 컬럼이 통째로 사라진다.
    const keys = Object.keys(only().extras);
    expect(keys).toContain('기본 업무정보 / 촬영 담당자');
  });

  it('출연자 연락처가 파싱 단계에서 보존된다', () => {
    // 마스킹은 T6의 응답 계층이다. 여기서 지우면 raw의 복원 가치가 사라진다.
    const task = only();
    const key = '섭외 / 출연자 연락처 (내부용)';

    expect(Object.keys(task.extras)).toContain(key);
    expect(Object.keys(task.raw)).toContain(key);
  });

  it('매핑된 컬럼과 업무ID·공동 담당자는 extras에서 빠진다', () => {
    const keys = Object.keys(only().extras);

    expect(keys).not.toContain('기본 업무정보 / 업무ID');
    expect(keys).not.toContain('기본 업무정보 / 공동 담당자');
    expect(keys).not.toContain('기본 업무정보 / 프로젝트명');
    expect(keys).not.toContain('관리 / 비고');
  });
});

describe('parseShootTeamTab — 팀 주차 목표 (완료 기준 7)', () => {
  it('헤더 위쪽 라벨-값 쌍에서 1건이 나온다', () => {
    expect(result.teamPeriodGoals).toEqual([
      {
        teamKey: 'shoot',
        periodLabel: '2026-07 4주차',
        goalText: '브랜드 필름 섭외 확정',
        riskText: '출연자 일정 미확정',
      },
    ]);
  });
});

describe('parseShootTeamTab — 경고 위생', () => {
  it('경고에 셀 값·이름·연락처가 들어 있지 않다', () => {
    const allowed = new Set(['code', 'sheet', 'row', 'column']);

    for (const warning of result.warnings as ParseWarning[]) {
      expect(Object.keys(warning).every((key) => allowed.has(key))).toBe(true);
      expect(warning.sheet).toBe('02_촬영·기획팀');
    }
    expect(JSON.stringify(result.warnings)).not.toMatch(/샘플|기획자|담당자|010-|example\.test/);
  });
});
