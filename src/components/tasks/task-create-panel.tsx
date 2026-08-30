'use client';

/**
 * **업무 생성** — 대시보드의 [＋ 업무 생성] 버튼과 그것이 여는 오른쪽 패널.
 *
 * ## 상세 패널과 **같은 모양**이다
 *
 * 예전에는 2열 격자에 라벨을 위에 얹은 폼이었다. 그래서 같은 업무를 만들 때와 고칠 때가
 * 화면에서 다른 물건처럼 보였고, 무엇보다 **만들 때 채울 수 있는 칸이 고칠 때보다 적다**는
 * 것이 눈에 띄지 않았다. 지금은 상세 패널의 표를 그대로 쓴다 — 라벨-값 한 줄, 같은 폭,
 * 같은 섹션 순서(기본 → 팀 전용 필드 → 단계). 만드는 화면은 **처음부터 수정 중인 상세
 * 패널**이다 (`task-detail-fields.tsx`·`task-stage-fields.tsx`).
 *
 * ## 팀을 고르면 그 팀의 칸이 선다
 *
 * 팀 전용 칸은 팀마다 다르고(촬영 55 · 마케팅 8 · 편집 0), 단계는 편집팀에만 있다. 그래서
 * 팀 `<select>`가 아래 두 섹션을 통째로 바꾼다 — 고른 값도 함께 비운다. 남겨 두면 촬영팀
 * 칸에 적은 값이 편집팀 업무에 실려 나가고, 다음 업로드가 그 칸을 통째로 지운다.
 *
 * 칸 목록은 **화면이 짓지 않는다**: 팀 전용 칸은 `teamExtraColumns`(그 팀 업무들의 키),
 * 단계 뼈대는 `stageTemplateFor`가 낸 것을 페이지가 값으로 넘긴다.
 *
 * ## 필수 칸은 별표를 달고, 안 채우면 저장이 열리지 않는다
 *
 * 고르는 기준은 하나다 — **그 값이 없으면 이 업무가 화면의 어떤 판정에도 걸리지 않는가.**
 * 자세한 근거는 `REQUIRED` 옆에 적었다. 막는 것은 **화면뿐이고 서버는 여전히 업무명만
 * 요구한다** (`task-create-schema.ts`): 이것은 권한이 아니라 입력 완성도라, 여기서 서버까지
 * 좁히면 나중에 스크립트로 업무를 넣는 길이 함께 막힌다.
 *
 * ## 열림을 URL에 두지 않는다
 *
 * 업무 **상세** 패널은 `?task=`가 열림이다 — 링크를 받은 사람이 같은 업무를 봐야 하기
 * 때문이다 (`UC-15`). 만들기 패널에는 그럴 대상이 없다: 빈 폼의 딥링크는 아무것도 가리키지
 * 않고, 뒤로 가기로 되살아난 빈 폼은 오히려 「내가 뭘 하다 말았지」가 된다.
 *
 * ## 만든 뒤에 그 업무를 연다
 *
 * 응답의 `task.id`로 상세 패널을 여는 주소로 옮긴다. 목록만 새로 그리면 방금 만든 줄을
 * 사용자가 표에서 찾아야 하고, 필터가 걸려 있으면 아예 안 보인다.
 *
 * ⚠ 그 주소를 **함수로 받지 않는다.** 서버 컴포넌트는 클라이언트 컴포넌트에 함수를 넘길 수
 * 없다(`Functions cannot be passed directly to Client Components`). 그래서 `pathname`과
 * `query`라는 **값**을 받고 `buildHref`를 여기서 부른다.
 *
 * **낙관적 업데이트를 하지 않는다** (`task-detail-fields.tsx`와 같은 규칙).
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { OwnerCandidate } from '@/components/tasks/task-detail-fields';
import type { StageTemplate } from '@/lib/domain/team-stage-template';
import { buildHref, type DashboardQuery } from '@/lib/view/dashboard-query';
import type { ExtraField } from '@/lib/view/extras-edit';
import { teamLabel } from '@/lib/view/team-slug';
import type { ApiErrorBody } from '@/types/api';
import type { TeamKey } from '@/types/task';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const FIELD =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-2 py-1 text-sm focus:outline-none';

/** 담당자 드롭다운의 「없음」. 빈 문자열은 「안 고름」과 구분되지 않아 값으로 쓰지 않는다 */
const UNASSIGNED = '';

interface Draft {
  teamId: TeamKey;
  title: string;
  status: string;
  progress: string;
  priority: string;
  riskStatus: string;
  approvalStatus: string;
  assignedAt: string;
  dueAt: string;
  nextAction: string;
  nextActionOwner: string;
  nextActionDue: string;
  note: string;
  ownerMemberId: string;
  coOwnerMemberIds: string[];
}

function emptyDraft(teamId: TeamKey): Draft {
  return {
    teamId,
    title: '',
    status: '',
    progress: '',
    priority: '',
    riskStatus: '',
    approvalStatus: '',
    assignedAt: '',
    dueAt: '',
    nextAction: '',
    nextActionOwner: '',
    nextActionDue: '',
    note: '',
    ownerMemberId: UNASSIGNED,
    coOwnerMemberIds: [],
  };
}

/**
 * **반드시 채우는 칸.** 기준은 「이 값이 없으면 그 업무가 화면의 어떤 판정에도 걸리지
 * 않는가」다 — 넣어 두면 좋은 값이 아니라, **없으면 그 줄이 현황판에서 유령이 되는 값.**
 *
 * - `title`: 표에서 어느 줄인지 알 수 없다. 서버도 이 하나는 이미 요구한다.
 * - `status`: 5색 배지도 「진행 중/완료/지연」 집계도 전부 상태에서 나온다 (`ADR-009`).
 *   비워 두면 그 업무는 대시보드의 어느 묶음에도 들어가지 않는다.
 * - `dueAt`: D-DAY·지연·마감 임박이 전부 이 값 위에 선다. 이 제품의 절반이 그 판정이다.
 * - `ownerMemberId`: 담당자 없는 업무는 「담당자 미지정」 경고로만 잡힌다 (`UC-12`). 만들
 *   때부터 그 상태로 두는 것은 만들자마자 알림을 하나 만드는 일이다.
 *
 * 나머지는 전부 선택이다 — 「일단 걸어 두고 나중에 채운다」가 회의 자리의 실제 동작이고,
 * 위 넷은 그 「나중」이 와도 사람이 다시 찾아오지 않는 칸들이다.
 *
 * ⚠ **담당자는 고를 사람이 있을 때만 필수다.** 팀 명부가 비어 있으면 채울 방법이 없어서,
 *   그때 필수로 두면 그 팀은 업무를 아예 만들 수 없다.
 */
const REQUIRED = ['title', 'status', 'dueAt', 'ownerMemberId'] as const;

const REQUIRED_LABEL: Readonly<Record<(typeof REQUIRED)[number], string>> = {
  title: '업무명',
  status: '상태',
  dueAt: '마감',
  ownerMemberId: '담당자',
};

export function TaskCreatePanel({
  teams,
  candidatesByTeam,
  statusOptions,
  extraColumnsByTeam,
  stageTemplateByTeam,
  pathname,
  query,
}: {
  /** `creatableTeams`가 낸 목록. 비어 있으면 이 컴포넌트가 아무것도 그리지 않는다 */
  teams: readonly TeamKey[];
  /**
   * 팀별 담당자 후보. 팀을 바꾸면 후보도 바뀌어야 해서 **팀 축으로 받는다** — 한 벌만 받아
   * 화면에서 걸러 내면 `assignableMembers`의 규칙이 두 곳이 된다.
   *
   * 브라우저로 나가는 것은 `{id, name}`뿐이다 (`MemberRecord`의 `authUserId`를 싣지 않는다 —
   * `S6`).
   */
  candidatesByTeam: Readonly<Partial<Record<TeamKey, readonly OwnerCandidate[]>>>;
  statusOptions: readonly string[];
  /**
   * 팀별 전용 칸 **전량** (`teamExtraColumns`). 값은 비어 있고 고를 값 목록·입력칸 종류만
   * 실려 온다 — 수정 폼이 쓰는 것과 **같은 모양**이라 두 화면의 칸이 갈리지 않는다.
   */
  extraColumnsByTeam: Readonly<Partial<Record<TeamKey, readonly ExtraField[]>>>;
  /** 팀별 단계 뼈대 (`stageTemplateFor`). 편집팀만 셋이고 나머지는 빈 배열이다 */
  stageTemplateByTeam: Readonly<Partial<Record<TeamKey, readonly StageTemplate[]>>>;
  /** 만든 뒤 열 주소를 여기서 짓는다 (머리말의 ⚠). 둘 다 **값**이라 직렬화된다 */
  pathname: string;
  query: DashboardQuery;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(teams[0] ?? 'edit'));
  /** 팀 전용 칸. 키가 팀마다 달라 `Draft`에 못박지 못한다 (수정 폼과 같은 이유) */
  const [extras, setExtras] = useState<Record<string, string>>({});
  /** 단계 값. `stageKey → 칸 → 값`. 뼈대는 서버가 정하므로 여기 없는 것은 값뿐이다 */
  const [stages, setStages] = useState<Record<string, Record<string, string>>>({});

  // 만들 수 있는 팀이 없으면 버튼도 없다 — 눌러도 400이 나는 버튼을 두지 않는다
  if (teams.length === 0) return null;

  const busy = sending || pending;
  const candidates = candidatesByTeam[draft.teamId] ?? [];
  const extraColumns = extraColumnsByTeam[draft.teamId] ?? [];
  const stageTemplate = stageTemplateByTeam[draft.teamId] ?? [];
  const set = (patch: Partial<Draft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  /*
   * 아직 비어 있는 필수 칸. **버튼을 잠그는 근거이자 안내 문구의 재료**다 — 「무엇이 남았는지」
   * 를 적지 않고 버튼만 잠그면 사용자가 화면을 훑으며 별표를 찾아야 한다.
   */
  const missing = REQUIRED.filter((key) => {
    if (key === 'ownerMemberId') return candidates.length > 0 && draft.ownerMemberId === UNASSIGNED;
    return draft[key].trim() === '';
  });

  function close(): void {
    setDraft(emptyDraft(teams[0] ?? 'edit'));
    setExtras({});
    setStages({});
    setMessage(null);
    setOpen(false);
  }

  /** 팀이 바뀌면 담당자 후보도 팀 전용 칸도 단계도 통째로 바뀐다 — 고른 값을 함께 비운다 */
  function changeTeam(teamId: TeamKey): void {
    setExtras({});
    setStages({});
    set({ teamId, ownerMemberId: UNASSIGNED, coOwnerMemberIds: [] });
  }

  async function submit(): Promise<void> {
    if (missing.length > 0) {
      setMessage(`${missing.map((key) => REQUIRED_LABEL[key]).join(' · ')}을(를) 채워 주세요.`);
      return;
    }

    setSending(true);
    setMessage(null);

    /*
     * **빈 칸은 아예 보내지 않는다.** 서버 스키마가 빈 문자열도 `null`로 접지만, 키를 빼는
     * 편이 「안 적었다」를 그대로 옮긴다 — 저장소가 기본값을 정하는 자리를 화면이 앞질러
     * 채우지 않는다.
     */
    const body: Record<string, unknown> = { teamId: draft.teamId, title: draft.title.trim() };
    for (const key of [
      'status',
      'priority',
      'riskStatus',
      'approvalStatus',
      'assignedAt',
      'dueAt',
      'nextAction',
      'nextActionOwner',
      'nextActionDue',
      'note',
    ] as const) {
      if (draft[key].trim() !== '') body[key] = draft[key];
    }
    if (draft.progress.trim() !== '') body.progress = Number(draft.progress);

    // 팀 전용 칸도 **적은 것만** 싣는다. 빈 칸을 `null`로 보내면 안 적은 것이 「비웠다」가 된다
    const filled = Object.entries(extras).filter(([, value]) => value.trim() !== '');
    if (filled.length > 0) body.extras = Object.fromEntries(filled);

    /*
     * 단계는 **뼈대가 있는 팀이면 전부 싣는다** — 값이 하나도 없어도 그렇다. 값이 있는 줄만
     * 보내면 「컨셉만 있고 제작·최종본은 없는」 타임라인이 만들어지고, 그 업무는 다음에
     * 단계를 적으려 할 때 고칠 줄이 없다.
     */
    if (stageTemplate.length > 0) {
      body.stages = stageTemplate.map((stage) => {
        const values = stages[stage.key] ?? {};
        const seed: Record<string, unknown> = { stageKey: stage.key };
        for (const key of ['plannedDate', 'actualDate', 'confirmStatus', 'content'] as const) {
          if ((values[key] ?? '').trim() !== '') seed[key] = values[key];
        }
        return seed;
      });
    }

    if (draft.ownerMemberId !== UNASSIGNED) body.ownerMemberId = draft.ownerMemberId;
    if (draft.coOwnerMemberIds.length > 0) body.coOwnerMemberIds = draft.coOwnerMemberIds;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      const created = (await response.json()) as { task?: { id?: string } };
      close();

      // 방금 만든 업무를 연다. id를 못 읽었으면 목록만 다시 그린다 (지어내지 않는다)
      if (typeof created.task?.id === 'string') {
        router.push(buildHref(pathname, query, { task: created.task.id }));
      }
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-ink hover:border-brand hover:text-brand rounded border px-3 py-1.5 text-xs"
      >
        ＋ 업무 생성
      </button>
    );
  }

  const setStage = (stageKey: string, field: string, value: string): void =>
    setStages((prev) => ({ ...prev, [stageKey]: { ...prev[stageKey], [field]: value } }));

  return (
    <>
      <button
        type="button"
        onClick={close}
        className="border-line text-ink-muted rounded border px-3 py-1.5 text-xs"
      >
        ＋ 업무 생성
      </button>

      {/* 상세 패널과 **같은 자리·같은 폭**이다 — 오른쪽에서 나오는 것이 둘이면 안 된다 */}
      <div className="fixed inset-0 z-40 flex justify-end">
        <button
          type="button"
          aria-label="패널 닫기"
          onClick={close}
          className="bg-ink/30 absolute inset-0"
        />

        <aside
          aria-label="업무 생성"
          className="border-line bg-panel relative z-10 h-full w-[660px] max-w-[92vw] overflow-y-auto border-l"
          style={{ animation: 'panel-slide-in 200ms ease-out' }}
        >
          <header className="border-line bg-panel sticky top-0 flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-brand text-sm font-semibold">업무 생성</h2>
              <p className="text-ink-muted mt-1 text-xs">
                시트에 없는 업무를 여기서 만듭니다. 시트 업로드가 덮어쓰지 않습니다.{' '}
                <span className="text-warn">*</span> 표시는 반드시 채웁니다.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="border-line text-ink-muted hover:border-brand hover:text-brand rounded border px-2 py-1 text-xs"
            >
              닫기
            </button>
          </header>

          <div className="space-y-6 px-5 py-4">
            <section>
              <h3 className="text-brand text-sm font-semibold">기본</h3>

              <dl className="mt-2">
                <Row label="팀" required>
                  <select
                    value={draft.teamId}
                    onChange={(event) => changeTeam(event.target.value as TeamKey)}
                    disabled={busy || teams.length === 1}
                    className={FIELD}
                  >
                    {teams.map((team) => (
                      <option key={team} value={team}>
                        {teamLabel(team)}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row label="업무명" required>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => set({ title: event.target.value })}
                    disabled={busy}
                    placeholder="예) [샘플] 카드뉴스 A"
                    className={FIELD}
                  />
                </Row>

                <Row label="담당자" required={candidates.length > 0}>
                  {candidates.length === 0 ? (
                    <p className="text-ink-muted text-xs">
                      이 팀의 시트 명부가 비어 있어 고를 사람이 없습니다.
                    </p>
                  ) : (
                    <select
                      value={draft.ownerMemberId}
                      onChange={(event) => set({ ownerMemberId: event.target.value })}
                      disabled={busy}
                      className={FIELD}
                    >
                      <option value={UNASSIGNED}>고르지 않음</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Row>

                <Row label="공동 담당">
                  {candidates.length === 0 ? (
                    <span className="text-ink-muted text-xs">고를 사람이 없습니다.</span>
                  ) : (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {candidates
                        // 주 담당은 목록에서 뺀다 — 서버도 겹치면 지운다
                        .filter((candidate) => candidate.id !== draft.ownerMemberId)
                        .map((candidate) => (
                          <label key={candidate.id} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={draft.coOwnerMemberIds.includes(candidate.id)}
                              onChange={(event) =>
                                set({
                                  coOwnerMemberIds: event.target.checked
                                    ? [...draft.coOwnerMemberIds, candidate.id]
                                    : draft.coOwnerMemberIds.filter((id) => id !== candidate.id),
                                })
                              }
                              disabled={busy}
                            />
                            <span className="text-ink-body">{candidate.name}</span>
                          </label>
                        ))}
                    </div>
                  )}
                </Row>

                <Row label="상태 (시트 원문)" required>
                  <select
                    value={draft.status}
                    onChange={(event) => set({ status: event.target.value })}
                    disabled={busy}
                    className={FIELD}
                  >
                    <option value="">고르지 않음</option>
                    {statusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row label="승인">
                  <Text
                    value={draft.approvalStatus}
                    onChange={(value) => set({ approvalStatus: value })}
                    busy={busy}
                  />
                </Row>
                <Row label="우선순위">
                  <Text
                    value={draft.priority}
                    onChange={(value) => set({ priority: value })}
                    busy={busy}
                  />
                </Row>
                <Row label="리스크">
                  <Text
                    value={draft.riskStatus}
                    onChange={(value) => set({ riskStatus: value })}
                    busy={busy}
                  />
                </Row>

                <Row label="진행률 (%)">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.progress}
                    onChange={(event) => set({ progress: event.target.value })}
                    disabled={busy}
                    className={`${FIELD} tabular-nums`}
                  />
                </Row>

                <Row label="배정일">
                  <Date value={draft.assignedAt} onChange={(v) => set({ assignedAt: v })} busy={busy} />
                </Row>
                <Row label="마감" required>
                  <Date value={draft.dueAt} onChange={(v) => set({ dueAt: v })} busy={busy} />
                </Row>

                <Row label="다음 조치">
                  <Text
                    value={draft.nextAction}
                    onChange={(value) => set({ nextAction: value })}
                    busy={busy}
                  />
                </Row>
                <Row label="다음 조치 담당">
                  <Text
                    value={draft.nextActionOwner}
                    onChange={(value) => set({ nextActionOwner: value })}
                    busy={busy}
                  />
                </Row>
                <Row label="다음 조치 기한">
                  <Date
                    value={draft.nextActionDue}
                    onChange={(v) => set({ nextActionDue: v })}
                    busy={busy}
                  />
                </Row>

                <Row label="비고">
                  <textarea
                    value={draft.note}
                    onChange={(event) => set({ note: event.target.value })}
                    disabled={busy}
                    rows={2}
                    className={FIELD}
                  />
                </Row>
              </dl>
            </section>

            {/*
              고른 팀의 전용 칸 **전량**. 목록은 그 팀 업무들의 키에서 오고(`teamExtraColumns`),
              없으면 이 자리도 없다 — 빈 제목만 남기면 「아직 그 팀 업무가 없다」와 「그 팀은
              전용 칸이 없다」가 화면에서 같아진다.
            */}
            {extraColumns.length > 0 && (
              <section>
                <h3 className="text-brand text-sm font-semibold">
                  팀 전용 필드
                  <span className="text-ink-muted ml-2 text-xs font-normal tabular-nums">
                    {extraColumns.length}칸
                  </span>
                </h3>
                <p className="text-ink-muted mt-1 text-xs">
                  {teamLabel(draft.teamId)} 업무가 쓰는 칸입니다. 고를 값은 시트 「설정」 탭에서
                  옵니다.
                </p>

                <dl className="mt-2">
                  {extraColumns.map((column) => (
                    <Row key={column.key} label={column.key}>
                      {column.options === null ? (
                        <input
                          type={column.kind}
                          value={extras[column.key] ?? ''}
                          onChange={(event) =>
                            setExtras((prev) => ({ ...prev, [column.key]: event.target.value }))
                          }
                          disabled={busy}
                          className={column.kind === 'text' ? FIELD : `${FIELD} tabular-nums`}
                        />
                      ) : (
                        <select
                          value={extras[column.key] ?? ''}
                          onChange={(event) =>
                            setExtras((prev) => ({ ...prev, [column.key]: event.target.value }))
                          }
                          disabled={busy}
                          className={FIELD}
                        >
                          <option value="">고르지 않음</option>
                          {column.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      )}
                    </Row>
                  ))}
                </dl>
              </section>
            )}

            {/*
              단계 뼈대가 있는 팀만. **줄을 여기서 만들거나 지울 수 없다** — 이름·순서·SLA는
              시트가 정하고 서버가 채운다 (`team-stage-template.ts`).
            */}
            {stageTemplate.length > 0 && (
              <section>
                <h3 className="text-brand text-sm font-semibold">단계</h3>
                <p className="text-ink-muted mt-1 text-xs">
                  {teamLabel(draft.teamId)} 업무의 단계입니다. 지금 비워 두어도 만든 뒤 패널에서
                  채울 수 있습니다.
                </p>

                <ol className="mt-2 space-y-3">
                  {stageTemplate.map((stage) => (
                    <li key={stage.key} className="border-line rounded border p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-ink text-sm break-words">{stage.label}</span>
                        <span className="text-ink-faint text-xs whitespace-nowrap tabular-nums">
                          {stage.slaDays === null ? '—' : `SLA ${stage.slaDays}일`}
                        </span>
                      </div>
                      <dl className="mt-2">
                        <Row label="계획일">
                          <Date
                            value={stages[stage.key]?.plannedDate ?? ''}
                            onChange={(value) => setStage(stage.key, 'plannedDate', value)}
                            busy={busy}
                          />
                        </Row>
                        <Row label="실제일">
                          <Date
                            value={stages[stage.key]?.actualDate ?? ''}
                            onChange={(value) => setStage(stage.key, 'actualDate', value)}
                            busy={busy}
                          />
                        </Row>
                        <Row label="확인 상태">
                          <Text
                            value={stages[stage.key]?.confirmStatus ?? ''}
                            onChange={(value) => setStage(stage.key, 'confirmStatus', value)}
                            busy={busy}
                          />
                        </Row>
                        <Row label="내용">
                          <textarea
                            value={stages[stage.key]?.content ?? ''}
                            onChange={(event) => setStage(stage.key, 'content', event.target.value)}
                            disabled={busy}
                            rows={2}
                            className={FIELD}
                          />
                        </Row>
                      </dl>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          <div className="border-line flex flex-wrap items-center gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || missing.length > 0}
              className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
                busy || missing.length > 0
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-brand-strong'
              }`}
            >
              {busy ? '만드는 중…' : '업무 만들기'}
            </button>
            {/* **무엇이 남았는지 적는다.** 버튼만 잠그면 사용자가 별표를 찾아 화면을 훑는다 */}
            <span className="text-ink-muted text-xs">
              {missing.length > 0
                ? `${missing.map((key) => REQUIRED_LABEL[key]).join(' · ')}이(가) 아직 비어 있습니다.`
                : '별표 없는 칸은 나중에 채워도 됩니다.'}
            </span>
          </div>

          {message !== null && <p className="text-late px-5 pb-5 text-sm">{message}</p>}
        </aside>
      </div>
    </>
  );
}

/**
 * 라벨-값 한 줄. **상세 패널의 `FieldRow`와 같은 격자다** — 만들 때와 고칠 때 같은 항목이
 * 같은 자리에 서야 눈이 다시 찾지 않는다.
 */
function Row({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="border-line/60 grid grid-cols-[200px_1fr] items-center gap-3 border-b py-1.5 text-sm">
      <dt className="text-ink-muted text-xs break-words">
        {label}
        {/* 색만으로 구분하지 않는다 — 별표라는 **글자**가 신호이고 색은 거들 뿐이다 */}
        {required === true && (
          <span className="text-warn ml-1" aria-label="필수">
            *
          </span>
        )}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Text({
  value,
  onChange,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
}): React.ReactNode {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={busy}
      className={FIELD}
    />
  );
}

function Date({
  value,
  onChange,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
}): React.ReactNode {
  return (
    <input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={busy}
      className={`${FIELD} tabular-nums`}
    />
  );
}
