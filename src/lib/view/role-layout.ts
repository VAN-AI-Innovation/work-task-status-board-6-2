/**
 * 역할별 진입 화면의 **섹션 순서**를 정한다 (T6 완료 기준 7, `H7` 헤지).
 *
 * ## 순서만 바꾼다. 삭제하지 않는다
 *
 * 세 역할이 보는 것은 **같은 데이터이고 같은 섹션**이다. 다른 것은 무엇이 맨 위에 오느냐뿐이고,
 * 필요한 사람이 스크롤하면 나머지도 다 있다. 삭제는 「권한」이고 그것은 T8이 서버에서 했다 —
 * 화면에서 섹션을 빼는 것으로는 아무것도 막지 못한다(URL 하나로 뚫린다). 지금도 마찬가지다.
 *
 * 그래서 이 파일이 지는 불변식은 **집합이 같다**는 것이다 — 어느 역할도 섹션을 잃지 않는다.
 *
 * **부원은 팀장과 같은 순서를 쓴다.** 예전에는 셋이 서로 달랐고 부원만 축약 KPI 3칸을 봤는데,
 * 부원의 화면이 팀 대시보드 하나로 좁혀지면서(`canSeeOrgDashboard`) 그 차이가 **같은 화면이
 * 계정마다 다른 모양**이라는 뜻이 됐다. 팀장과 부원은 같은 팀 화면을 보고 같은 이야기를 한다.
 *
 * T8에서 진짜 인증이 붙었고 바뀐 것은 「누가 admin인가」뿐이다 — 이 표는 그대로 섰다.
 *
 * ## 역할을 여기서 판정하지 않는다
 *
 * 인자로 받는 `role`은 `resolveViewerRole`이 판정한 결과다 (`S4`·`ADR-013`). 이 파일이
 * `?as=`를 다시 읽으면 「프로덕션에서 `?as=`를 무시한다」는 규칙이 두 곳이 되고, 그중 한 곳만
 * 고쳐지는 날 인증 우회가 생긴다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

export type SectionKey =
  | 'kpi'
  | 'goals'
  | 'teams'
  | 'completion'
  | 'charts'
  | 'alerts'
  | 'approvals'
  | 'tasks';

/**
 * 근거는 페르소나의 첫 질문이다 (`PLAN.md`「사용자 여정」).
 *
 * - `admin` — 「전사가 잘 돌고 있나」. KPI가 회의 직전 5분에 쓰이는 것이다
 *   (`UC-07`·`UC-10`). 주간 브리핑은 전용 화면(`/report`)이 진다.
 * - `lead` — 「지금 손대야 할 것」. 알림과 승인 대기가 먼저다 (`UC-12`·`UC-13`).
 * - `member` — **팀장과 같다.** 부원이 보는 화면은 팀 대시보드 하나이고(`canSeeOrgDashboard`),
 *   거기서 팀장과 부원이 같은 이야기를 한다. 「내 마감」은 업무 표가 맨 위인 팀 화면 배치
 *   (`TEAM_PAGE_LAYOUT.first`)가 이미 답한다 (`UC-14`).
 *
 * **접히는 카드 둘의 순서는 세 역할이 같다** — 승인 대기함 다음이 목표 대비 성과다. 역할마다
 * 뒤집으면 같은 사람이 `?as=`로 역할을 옮길 때 두 카드가 자리를 바꾸고, 그 차이를 설명할 수
 * 있는 사람이 아무도 없다. 역할이 가르는 것은 **위쪽 요약 행의 순서**다.
 */
/** 팀장·부원이 함께 쓰는 순서. 「지금 손대야 할 것」이 먼저다 */
const STAFF_ORDER: readonly SectionKey[] = [
  'alerts',
  'approvals',
  'kpi',
  'teams',
  'completion',
  'charts',
  'tasks',
  'goals',
];

export const SECTION_ORDER: Readonly<Record<ViewerRole, readonly SectionKey[]>> = {
  admin: [
    'kpi',
    'teams',
    'completion',
    'charts',
    'alerts',
    'approvals',
    'goals',
    'tasks',
  ],
  lead: STAFF_ORDER,
  // **같은 배열이다** (머리말). 갈라 적으면 한쪽만 고쳐지는 날이 온다
  member: STAFF_ORDER,
};

export function sectionsFor(role: ViewerRole): readonly SectionKey[] {
  return SECTION_ORDER[role];
}

/**
 * ## 배치 — 12열 그리드에 흘려보낸다 (`ADR-019`)
 *
 * 세로로 쌓으면 요약을 보는 데 스크롤이 필요하고, **스크롤해야 보이는 요약은 요약이 아니다.**
 * 그래서 섹션마다 폭(`SECTION_SPAN`)과 zone(`SECTION_ZONE`)을 주고 행으로 묶는다.
 *
 * zone 순서를 상수로 박지 않고 **역할 배열에서 유도**하는 것이 요점이다. 완료 기준 7이 묻는
 * 것은 「무엇이 맨 위냐」이고, 첫 등장 순서를 쓰면 `admin`·`lead`는 `summary`부터,
 * `member`는 `table`(자기 업무)부터 시작한다 — 이 파일에 역할 분기를 하나도 더하지 않고
 * 그 성질이 보존된다.
 */
export type SectionZone = 'summary' | 'detail' | 'table';

/** 그리드 열 수. `UI_GUIDE.md`「레이아웃」의 `grid-cols-12`와 같은 숫자다 */
const COLUMNS = 12;

/**
 * `detail`은 `<details>`로 **접힌다.** 접는 것과 삭제하는 것은 다르다 — 제목 줄은 항상
 * 남는다. 접힌 것과 없는 것이 화면에서 같아 보이면 안 된다 (알림의 0건 묶음과 같은 규칙).
 */
export const SECTION_ZONE: Readonly<Record<SectionKey, SectionZone>> = {
  kpi: 'summary',
  charts: 'summary',
  alerts: 'summary',
  teams: 'summary',
  completion: 'summary',
  goals: 'detail',
  approvals: 'detail',
  tasks: 'table',
};

/**
 * 12열 중 몇 칸인가. **알림이 5칸인 것이 이번 변경의 출발점이다** — 12칸을 혼자 쓰는 바람에
 * 항목 이름과 건수 사이가 화면 폭만큼 벌어졌다. 팀별 현황(7)과 합이 정확히 12라 한 행에 선다.
 */
export const SECTION_SPAN: Readonly<Record<SectionKey, number>> = {
  kpi: 12,
  charts: 7,
  alerts: 5,
  teams: 6,
  completion: 6,
  goals: 6,
  approvals: 6,
  tasks: 12,
};

/**
 * 접힌 줄에 적는 이름. **컴포넌트 안의 `<h2>`와 같은 말이어야 한다** — 접었을 때와 펼쳤을 때
 * 다른 이름이 뜨면 같은 카드인지 눌러 봐야 안다. 화면이 손으로 적지 않도록 여기 둔다.
 */
export const DETAIL_LABELS: Readonly<Partial<Record<SectionKey, string>>> = {
  goals: '목표 대비 성과',
  approvals: '승인 대기함',
};

/**
 * 옆·아래 카드 높이에 맞춰 **늘어나지 않는 섹션**. KPI 타일이 늘어나면 숫자 하나만 뜬 빈
 * 상자가 되고 — 남는 세로는 같은 칸에 쌓인 차트가 가져가야 한다 — 알림은 제 묶음 다섯 줄이
 * 곧 높이다: 옆 칸(축약 KPI + 상태 분포)을 따라 늘어나면 목록 아래가 통째로 희게 남는다.
 */
export const FIXED_HEIGHT: readonly SectionKey[] = ['kpi', 'alerts'];

/** 한 칸에 들어갈 것. 배열이면 **세로로 쌓인다** (상태 분포 아래 목표 대비 성과처럼) */
export type CellSpec = SectionKey | readonly SectionKey[];

export interface LayoutCell {
  /** 이 칸에 세로로 쌓이는 섹션들. 대부분 하나다 */
  keys: SectionKey[];
  span: number;
}

export interface LayoutRow {
  zone: SectionZone;
  cells: LayoutCell[];
}

/**
 * 화면 하나의 배치. 세 값이 전부 **`layoutFor`의 입력**이며 화면과 테스트가 같은 것을 본다.
 *
 * `groups`가 있는 이유: 자동 배치(first-fit)는 빈칸을 줄여 주지만 **무엇과 무엇이 나란히
 * 서야 하는지**는 모른다. 「팀별 현황 옆에 팀별 완료율」·「알림 옆에 상태 분포」는 데이터의
 * 성질에서 오는 짝이라 화면이 정한다. 짝을 명시한 행은 first-fit이 건드리지 않는다.
 */
export interface ScreenLayout {
  /** 이 화면이 그릴 수 있는 섹션. 없으면 전부 */
  only?: readonly SectionKey[];
  /**
   * **맨 위로 끌어올릴 섹션.** 여기 적힌 순서대로 앞에 서고 나머지는 원래 순서를 지킨다.
   *
   * 역할 배열(`SECTION_ORDER`)을 고치지 않고 화면 옵션으로 두는 것이 요점이다 — 「업무 표가
   * 맨 위」는 **화면의 성질**이지 역할의 성질이 아니고, 역할 배열을 뒤집으면 셋 다 첫 줄이
   * 같아져 완료 기준 7이 재는 차이가 사라진다. 이 옵션은 첫 줄만 가져갈 뿐 그 아래 순서는
   * 여전히 역할마다 다르다.
   */
  first?: readonly SectionKey[];
  /** 이 화면에서의 폭. 적지 않은 섹션은 `SECTION_SPAN` 그대로 */
  spans?: Partial<Record<SectionKey, number>>;
  /** 한 행에 나란히 세울 칸들 */
  groups?: readonly (readonly CellSpec[])[];
}

const toKeys = (spec: CellSpec): SectionKey[] =>
  typeof spec === 'string' ? [spec] : [...spec];

const widthOf = (row: LayoutRow): number =>
  row.cells.reduce((acc, cell) => acc + cell.span, 0);

/**
 * **업무 표가 맨 위다 — 두 화면 모두.**
 *
 * 요약을 위에 두면 「지금 무엇을 해야 하나」가 늘 스크롤 아래에 있다. 이 화면들을 여는
 * 사람은 대부분 업무 한 건을 찾으러 오고(`?task=`로 패널을 여는 것이 이 제품의 주된 동작이다),
 * 요약은 그 표를 읽다가 고개를 드는 자리에 있으면 된다. 부원은 원래부터 그랬고
 * (`SECTION_ORDER.member`), 이제 세 역할이 같은 자리에서 업무를 본다.
 *
 * **두 화면에 같은 값을 준다.** 한쪽만 올리면 같은 사람이 대시보드와 팀 화면을 오갈 때
 * 업무 표가 위아래로 뛴다 — `SUMMARY_ROW`를 공유하는 것과 같은 이유다.
 *
 * 첫 줄만 가져갈 뿐 **그 아래 순서는 역할마다 그대로 다르다** (`lead`는 알림, `admin`은
 * KPI가 먼저다). 완료 기준 7이 재는 차이는 거기 남아 있다.
 */
const TASKS_FIRST: readonly SectionKey[] = ['tasks'];

/**
 * **두 화면이 공유하는 요약 행.** 「지금 문제(알림)」 옆에 「전체 그림(축약 KPI + 상태 분포)」을
 * 세우는 짝이며, 폭은 6 + 6이다 — 어느 쪽도 곁다리가 아니라서 한쪽이 좁으면 그쪽이 부속처럼
 * 읽힌다.
 *
 * 값을 한곳에 두는 이유: 대시보드와 팀 화면이 이 행을 다르게 두면 같은 사람이 화면을 옮길 때
 * **카드가 자리를 바꾼다.** 예전에 팀 화면이 알림 7 + [상태 분포·목표] 5였고 축약 KPI는 제
 * 줄을 통째로 썼는데, 그 차이를 설명할 수 있는 사람이 아무도 없었다.
 */
const SUMMARY_ROW = {
  spans: { alerts: 6, charts: 6 },
  groups: [['alerts', 'charts']],
} as const satisfies Pick<ScreenLayout, 'spans' | 'groups'>;

/**
 * 팀 화면의 배치. **대시보드와 같은 값이다** — `spans`·`groups`가 `DASHBOARD_LAYOUT`과
 * 글자까지 같고, 다른 것은 `only`(그릴 수 있는 섹션이 적다) 하나뿐이다.
 *
 * 예전에는 달랐다(알림 7 + [상태 분포·목표] 5, 축약 KPI는 12칸 제 줄). 그러면 같은 사람이
 * 대시보드에서 팀 화면으로 넘어갈 때 **카드가 자리를 바꾼다** — KPI 타일이 위 한 줄에서
 * 알림 오른쪽으로, 알림은 두 단에서 한 단으로. 화면 둘이 같은 것을 다르게 배치하면
 * 사용자는 매번 어디를 봐야 하는지 다시 찾는다.
 *
 * `only`가 걸러 낸 자리는 `layoutFor`가 알아서 접는다 — 짝에서 없는 섹션이 빠지면 남은
 * 칸만 세운다. 그래서 역할별로 축약 KPI가 없어도(admin·lead) 이 값을 갈라 둘 필요가 없다.
 *
 * 화면이 아니라 여기 두는 이유는 배치가 화면 지식이 아니라 **`layoutFor`의 입력**이고,
 * 화면과 테스트가 같은 값을 봐야 하기 때문이다.
 */
export const TEAM_PAGE_LAYOUT: ScreenLayout = {
  only: ['kpi', 'charts', 'goals', 'alerts', 'tasks'],
  first: TASKS_FIRST,
  ...SUMMARY_ROW,
};

/**
 * 대시보드의 배치. 짝이 둘이다 — **팀별 현황 + 팀별 완료율**(같은 팀 축을 표와 그림으로
 * 보는 둘)과 **알림 + 상태 분포**(「지금 문제」와 「전체 그림」).
 *
 * 뒤의 짝은 **6 + 6이다.** 어느 쪽도 곁다리가 아니라서 한쪽이 좁으면 그쪽이 부속처럼 읽힌다.
 * `member`의 축약 KPI 3칸은 그 오른쪽 칸에 **상태 분포 위로 쌓는다** — 12칸을 혼자 쓰면
 * 타일 셋 사이가 화면 폭만큼 벌어지고 알림 옆은 그만큼 빈다. 10칸짜리 전체 KPI(`kpi`)는
 * 여기 넣지 않는다: 5열 그리드를 6칸에 밀어 넣으면 라벨이 두 줄로 접힌다.
 */
export const DASHBOARD_LAYOUT: ScreenLayout = {
  first: TASKS_FIRST,
  spans: SUMMARY_ROW.spans,
  // 전사 요약표 짝은 대시보드에만 있다 — 팀 화면에는 그 두 섹션 자체가 없다(`only`)
  groups: [['teams', 'completion'], ...SUMMARY_ROW.groups],
};

/**
 * 화면이 실제로 그릴 행 목록. 역할별 순서(`sectionsFor`)를 zone 단위로 묶고, 화면이 정한
 * 짝(`groups`)은 그대로 한 행으로 세운다.
 *
 * 짝에 속하지 않은 섹션만 **first-fit**으로 앞 행의 빈자리를 채운다 — 짝 행에 끼어들면
 * 화면이 의도한 조합이 깨지므로 그 행은 열어 두지 않는다.
 */
export function layoutFor(role: ViewerRole, screen: ScreenLayout = {}): LayoutRow[] {
  const allowed =
    screen.only === undefined
      ? sectionsFor(role)
      : sectionsFor(role).filter((key) => screen.only?.includes(key));

  /*
   * `first`는 순서만 바꾼다 — 목록에 없는 섹션을 **더하지 않고**(`only`가 이미 걸렀다)
   * 있는 섹션을 빼지도 않는다. 그래서 아래 배치 규칙은 이 줄을 몰라도 된다.
   */
  const first = screen.first ?? [];
  const sections: readonly SectionKey[] =
    first.length === 0
      ? allowed
      : [
          ...first.filter((key) => allowed.includes(key)),
          ...allowed.filter((key) => !first.includes(key)),
        ];

  // 첫 등장 순서. `Set`이 삽입 순서를 지키므로 여기서 정렬하지 않는다
  const zones = [...new Set(sections.map((key) => SECTION_ZONE[key]))];
  const spans = screen.spans ?? {};
  const groups = screen.groups ?? [];
  const spanOf = (key: SectionKey): number => spans[key] ?? SECTION_SPAN[key];

  /*
   * zone을 넘나든다. 짝이 zone을 섞을 수 있기 때문이다 — 팀 화면의 「상태 분포 + 목표 대비
   * 성과」가 그렇다(앞은 `summary`, 뒤는 `detail`). 먼저 놓인 쪽이 가져가고 남은 zone에서는
   * 건너뛴다. 그러지 않으면 같은 섹션이 두 번 그려진다.
   */
  const placed = new Set<SectionKey>();
  const rows: LayoutRow[] = [];

  for (const zone of zones) {
    /** 이 zone에서 first-fit으로 더 채울 수 있는 행. 짝 행은 여기 들어가지 않는다 */
    const open: LayoutRow[] = [];

    for (const key of sections.filter((item) => SECTION_ZONE[item] === zone)) {
      if (placed.has(key)) continue;

      const group = groups.find((cells) =>
        cells.some((spec) => toKeys(spec).includes(key))
      );

      if (group !== undefined) {
        const cells = group
          .map((spec) => toKeys(spec).filter((item) => sections.includes(item)))
          .filter((keys) => keys.length > 0)
          .map((keys) => ({ keys, span: spanOf(keys[0]!) }));

        for (const cell of cells) for (const item of cell.keys) placed.add(item);
        rows.push({ zone, cells });
        continue;
      }

      placed.add(key);
      const span = spanOf(key);
      const room = open.find((row) => widthOf(row) + span <= COLUMNS);

      if (room === undefined) {
        const row: LayoutRow = { zone, cells: [{ keys: [key], span }] };
        rows.push(row);
        open.push(row);
      } else {
        room.cells.push({ keys: [key], span });
      }
    }
  }

  return rows;
}
