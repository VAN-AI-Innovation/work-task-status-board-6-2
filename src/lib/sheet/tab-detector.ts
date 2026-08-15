/**
 * 탭이 어느 종류인지 **이름과 헤더 시그니처 두 축으로** 판별한다.
 *
 * 이름만 보면 안 되는 이유: 사람이 탭 이름을 바꾼다. 실제 설정 탭 이름은 `설정`이 아니라
 * `99_설정`이었다 (T1 실측) — 정확 일치로 짰으면 거기서 이미 깨졌다.
 * 시그니처만 보면 안 되는 이유: 헤더가 비슷한 탭이 생기면 갈린다. 이름이 보조 근거로 남는다.
 *
 * **시그니처가 이름을 이긴다.** 헤더는 데이터 구조라 함부로 바뀌지 않고, 이름은 사람이
 * 언제든 바꾸기 때문이다.
 *
 * - 모르는 탭에서 예외를 던지지 않는다. `unknown`은 정상적인 결과이고,
 *   `NO_KNOWN_TAB`·`SETTINGS_TAB_MISSING`은 워크북 전체를 본 뒤 파이프라인(T5)이 판정한다.
 * - `00_통합 대시보드`도 판별한다. 읽지 않기로 한 것은 파이프라인의 결정이고,
 *   여기서 `unknown`으로 뱉으면 T5의 `NO_KNOWN_TAB` 판정이 오염된다.
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { findHeaderBands, resolveHeaders } from '@/lib/sheet/header-resolver';
import type { HeaderColumn, SheetGrid, SheetTabKind, TabDetection, TabMatch } from '@/types/sheet';

interface TabSignature {
  key: string;
  kind: Exclude<SheetTabKind, 'unknown'>;
  /** 시트 이름에 **부분 일치**로 건다 — `99_설정`처럼 번호 접두사가 붙어 있다 */
  namePattern: RegExp;
  required: string[];
}

/**
 * 탭이 늘면 이 표에 한 줄만 추가한다. 절차적 분기로 옮기지 말 것.
 * 한 탭에 시그니처가 둘인 종류가 있다 — 마케팅(A 문의 / B 성과)과 대시보드(KPI / 요약표).
 */
const TAB_SIGNATURES: TabSignature[] = [
  {
    key: 'edit_team',
    kind: 'edit_team',
    namePattern: /편집/,
    required: ['업무명', '담당자', '배정일', '컨셉·레퍼런스', '제작 진행', '최종본·업로드'],
  },
  {
    key: 'shoot_team',
    kind: 'shoot_team',
    namePattern: /촬영|기획/,
    required: ['업무ID', '프로젝트명', '기획 담당자', '촬영 담당자', '섭외 상태'],
  },
  {
    key: 'marketing_inquiry',
    kind: 'marketing_team',
    namePattern: /마케팅|관리/,
    required: ['문의 ID', '문의 접수일', '답변 상태', '답변 기한'],
  },
  {
    key: 'marketing_goal',
    kind: 'marketing_team',
    namePattern: /마케팅|관리/,
    required: ['마케팅 과제명', '목표 KPI', '목표 수치', '실제 성과', '달성률'],
  },
  {
    key: 'settings',
    kind: 'settings',
    namePattern: /설정/,
    required: [
      '공통_진행 상태',
      '공통_우선순위',
      '공통_승인 상태',
      '공통_리스크 상태',
      '기본 SLA 설정_항목',
    ],
  },
  {
    key: 'dashboard_kpi',
    kind: 'dashboard',
    namePattern: /통합|대시보드/,
    required: ['전체 활성 업무', '전체 완료율', '이번 주 마감'],
  },
  {
    key: 'dashboard_summary',
    kind: 'dashboard',
    namePattern: /통합|대시보드/,
    required: ['팀', '전체 업무', '완료율'],
  },
];

/** PLAN.md「4. 엑셀 파싱 파이프라인」의 "필수 컬럼 3개 이상" */
const MIN_SIGNATURE_MATCH = 3;

/**
 * 컬럼 경로의 조각 하나가 필수 문자열로 **시작하면** 일치다.
 * 정확 일치가 아닌 이유는 그룹 라벨이 `컨셉·레퍼런스 (+2일)`처럼 접미사를 달고 있어서다
 * (step 3에서 원문을 보존하기로 했다). 접두 일치는 `담당자`가 `기획 담당자`를 잡지 않는다.
 */
function matchRequired(columns: HeaderColumn[], required: string[]): string[] {
  return required.filter((name) => columns.some((c) => c.path.some((p) => p.startsWith(name))));
}

interface SignatureHit {
  signature: TabSignature;
  match: TabMatch;
}

/**
 * 같은 시그니처가 여러 밴드에 맞으면 **가장 많이 맞은 밴드 하나만** 남긴다.
 * 2단 헤더는 그룹 행 단독(`{groupRow:null,labelRow:7}`)도 후보라서, `01_편집팀`에서
 * 그룹 라벨 3개만 맞은 밴드와 결합 6개가 맞은 진짜 밴드가 함께 잡힌다. 둘 다 넘기면
 * T3가 어느 쪽이 헤더인지 다시 골라야 한다. 동수면 위쪽 밴드를 남긴다.
 * 서로 다른 시그니처(마케팅 A·B, 대시보드 KPI·요약표)는 그대로 둘 다 남는다.
 */
function keepBestBandPerSignature(hits: SignatureHit[]): SignatureHit[] {
  const best = new Map<string, SignatureHit>();
  for (const hit of hits) {
    const current = best.get(hit.signature.key);
    if (!current || hit.match.matched.length > current.match.matched.length) {
      best.set(hit.signature.key, hit);
    }
  }
  return [...best.values()];
}

/**
 * 서로 다른 `kind`가 동시에 맞았을 때의 우선순위:
 * 1) 맞은 컬럼 수가 많은 쪽 — 같은 종류의 시그니처 여럿이 맞아도 **합산하지 않는다**
 *    (마케팅처럼 시그니처가 둘인 종류가 개수만으로 이기면 안 된다). 가장 잘 맞은 하나로 잰다.
 * 2) 동수면 이름까지 맞는 쪽
 * 3) 그래도 동수면 레지스트리 정의 순서
 */
function pickKind(hits: SignatureHit[], nameKinds: Set<SheetTabKind>): SheetTabKind {
  const score = (kind: SheetTabKind) => ({
    matched: Math.max(...hits.filter((h) => h.signature.kind === kind).map((h) => h.match.matched.length)),
    named: nameKinds.has(kind) ? 1 : 0,
    order: TAB_SIGNATURES.findIndex((s) => s.kind === kind),
  });

  const kinds = [...new Set(hits.map((h) => h.signature.kind))];
  return kinds.reduce((best, kind) => {
    const a = score(kind);
    const b = score(best);
    if (a.matched !== b.matched) return a.matched > b.matched ? kind : best;
    if (a.named !== b.named) return a.named > b.named ? kind : best;
    return a.order < b.order ? kind : best;
  });
}

export function detectTab(sheet: SheetGrid): TabDetection {
  const nameHits = TAB_SIGNATURES.filter((s) => s.namePattern.test(sheet.name));
  const nameKinds = new Set<SheetTabKind>(nameHits.map((s) => s.kind));

  // 헤더 밴드 후보 × 시그니처를 전수 대조한다. 밴드를 미리 하나로 좁히면
  // 마케팅 탭의 B섹션이 통째로 사라진다.
  const found: SignatureHit[] = [];
  for (const band of findHeaderBands(sheet)) {
    const columns = resolveHeaders(sheet, band);
    for (const signature of TAB_SIGNATURES) {
      const matched = matchRequired(columns, signature.required);
      if (matched.length < MIN_SIGNATURE_MATCH) continue;
      found.push({ signature, match: { signatureKey: signature.key, band, matched } });
    }
  }
  const hits = keepBestBandPerSignature(found);

  if (hits.length > 0) {
    const kind = pickKind(hits, nameKinds);
    return {
      sheet: sheet.name,
      kind,
      matchedBy: nameKinds.has(kind) ? 'both' : 'signature',
      matches: hits.filter((h) => h.signature.kind === kind).map((h) => h.match),
    };
  }

  if (nameHits.length > 0) {
    return { sheet: sheet.name, kind: nameHits[0].kind, matchedBy: 'name', matches: [] };
  }

  return { sheet: sheet.name, kind: 'unknown', matchedBy: 'none', matches: [] };
}
