'use client';

/**
 * 업무 상세 사이드 패널. **촬영·기획팀 70컬럼을 쓸 수 있게 만드는 것이 이 화면이다**
 * (`ADR-002`·`UC-15`) — 표는 공통 8칸만 뿌리기로 했으므로 나머지 60여 칸이 보이는 자리는
 * 여기뿐이다. 그래서 `extras`를 **개수 제한 없이 전량** 나열한다. 접거나 「더 보기」로
 * 숨기면 그 팀의 데이터는 다시 화면에서 사라진다.
 *
 * ## 여는 것도 닫는 것도 URL이다. 다만 **닫기는 기다리지 않는다**
 *
 * `?task=<id>`가 열림이고, 닫기는 그 키를 지운 주소로 **이동**한다. Esc·오버레이 클릭·
 * 닫기 버튼 셋이 전부 같은 이동이다. 클라이언트 상태로 열면 딥링크(완료 기준 6)와
 * 뒤로 가기가 죽는다 — 링크를 받은 사람이 패널이 닫힌 화면을 보게 된다.
 *
 * 닫을 때만 **지우는 것을 먼저** 한다(`closing`). 이동이 끝나기를 기다리면 패널이 화면에
 * 남은 채 서버 컴포넌트가 다시 그려지고, 이 화면은 `force-dynamic`이라 그 사이에 저장소
 * 조회가 통째로 한 번 더 돈다. 상태를 하나 두지만 **열림의 소스는 여전히 URL이다** —
 * 이 컴포넌트는 `?task=`가 없으면 마운트되지 않으므로 되돌아올 상태가 없다.
 *
 * 슬라이딩을 `transition`이 아니라 keyframe으로 두는 것도 같은 이유다. 패널은 열릴 때
 * **마운트**되므로 옮겨갈 이전 상태가 없다. 시작 위치를 `useState`로 한 번 푸는 방법도
 * 있지만, 그러면 패널이 열림 여부를 자기 상태로 들고 있는 것처럼 읽힌다.
 *
 * ## 수정 폼도 판정을 하지 않는다
 *
 * `canEdit`은 페이지가 `lib/domain/viewer-scope.ts`의 범위 판정을 불러 내려 준다. 여기서
 * 역할을 다시 읽으면 「누가 무엇을 고칠 수 있나」의 규칙이 셋째 자리에 생기고, 그 자리는
 * 서버가 보지 않는다.
 *
 * 손대는 칸이 **둘이고 서로 다른 사람의 것**이다 (`lib/domain/task-authoring.ts`).
 * 담당자 지정은 대표·팀장에게, 상태·진행률은 팀장·부원에게 열린다 — 그래서 플래그도 폼도
 * 둘이다. 한 덩어리로 묶으면 어느 역할에서든 쓰지 않는 칸이 하나씩 딸려 온다.
 *
 * ## 마스킹을 여기서 하지 않는다
 *
 * `cells`는 서버가 `toExtraCells`로 만들어 넘긴다. 민감 값은 그 전에 이미 응답 계층이
 * 지웠다 (`S6`) — 패널은 그 `null`이 「가려진 것」인지 「원래 없는 것」인지 표시만 한다.
 * 링크도 마찬가지로 `href`가 있을 때만 앵커다 (`S7` — 판정은 `safeHref`가 이미 했다).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CopyButton } from '@/components/tasks/copy-button';
import { StatusBadge } from '@/components/tasks/status-badge';
import { ApprovalActions } from '@/components/alerts/approval-actions';
import { TaskDetailFields, type OwnerCandidate } from '@/components/tasks/task-detail-fields';
import { TaskDeleteButton } from '@/components/tasks/task-delete-button';
import type { ExtraField } from '@/lib/view/extras-edit';
import { safeHref, type ExtraCell } from '@/lib/view/extras-render';
import { EMPTY, formatDate } from '@/lib/view/kpi-format';
import { teamLabel } from '@/lib/view/team-slug';
import type { TaskResponse } from '@/types/api';
import type { TaskStage } from '@/types/task';

function text(value: string | null): string {
  return value === null || value.trim() === '' ? EMPTY : value;
}

/** 라벨-값 한 줄. 패널 전체가 이 모양 하나로 서 있다 (`ADR-002`「라벨-값 나열」) */
function Row({
  label,
  value,
  href,
  faint,
}: {
  label: string;
  value: string;
  href?: string | null;
  faint?: boolean;
}) {
  /*
   * 복사 대상은 **하이퍼링크 셀만이 아니다.** 시트의 「내용」 칸에는 URL이 그냥 텍스트로
   * 들어 있는 경우가 더 많고(문서·캔바 링크), 그것도 옮겨 붙이려고 적어 둔 값이다.
   * 판정은 `safeHref`가 이미 진다 — `http`·`https`만 통과한다 (`S7`).
   *
   * 텍스트 URL을 **앵커로 만들지는 않는다.** 앵커는 여전히 하이퍼링크 셀에서만 나온다
   * (`UI_GUIDE.md`「링크 렌더링」) — 여기서 넓히면 시트 값이 곧 클릭 가능한 링크가 되고,
   * 그 판단은 이 컴포넌트가 아니라 응답 계층이 져야 한다.
   */
  const linkToCopy = href ?? safeHref(value);

  return (
    <div className="border-line/60 grid grid-cols-[256px_1fr] gap-3 border-b py-1.5 text-sm">
      <dt className="text-ink-muted min-w-0 text-xs break-words">{label}</dt>
      {/*
       * `min-w-0`이 없으면 그리드 칸의 최소 폭이 **내용 폭**이라, 띄어쓰기 없는 긴 URL이
       * 칸을 밀어내고 패널 밖으로 잘려 나간다. `break-words`만으로는 못 막는다.
       * `overflow-wrap: anywhere`는 한 낱말 안에서도 끊게 해 준다 — 링크가 잘리지 않는 것이
       * 이 패널의 존재 이유(70컬럼을 다 보여 준다)와 직결된다.
       */}
      <dd
        className={`flex min-w-0 items-start gap-2 [overflow-wrap:anywhere] ${
          faint === true ? 'text-ink-faint' : 'text-ink-body'
        }`}
      >
        <span className="min-w-0 flex-1">
          {href === undefined || href === null ? (
            value
          ) : (
            // 스킴 검사를 통과한 링크만 여기 온다. 외부로 나가므로 opener를 끊는다 (`S7`)
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink hover:text-brand underline-offset-4 hover:underline"
            >
              {value}
            </a>
          )}
        </span>
        {linkToCopy !== null && <CopyButton value={linkToCopy} label={label} />}
      </dd>
    </div>
  );
}

/**
 * 실제일이 계획일보다 늦은 단계만 **그 날짜 한 칸**이 앰버다. 행 전체를 칠하면 지연 빨강과
 * 함께 화면에 색이 두 뜻으로 존재하게 된다 (`UI_GUIDE.md`「눈에 띄는 것은 문제뿐이다」).
 */
function isLate(stage: TaskStage): boolean {
  return (
    stage.plannedDate !== null && stage.actualDate !== null && stage.actualDate > stage.plannedDate
  );
}

export function TaskPanel({
  task,
  stages,
  cells,
  extraFields,
  closeHref,
  canEdit,
  canAssign,
  canDelete,
  readOnly,
  readOnlyReason,
  ownerCandidates,
  statusOptions,
  lockedFields,
}: {
  task: TaskResponse;
  stages: TaskStage[];
  cells: ExtraCell[];
  /** 팀 전용 칸 중 **고칠 수 있는 것**. 서버가 골라 넘긴다 (`extras-edit.ts`) */
  extraFields: readonly ExtraField[];
  closeHref: string;
  /**
   * 범위 판정(`lib/domain/viewer-scope.ts`)의 결과를 **페이지가 계산해 내려 준다.**
   * 이 컴포넌트는 역할을 다시 해석하지 않는다 — 숨김은 방어가 아니고
   * (`task-detail-fields.tsx` 머리말) 실제 거부는 `PATCH`가 한다.
   */
  canEdit: boolean;
  /**
   * 담당자 지정 칸을 그릴 것인가. `canEdit`과 **다른 물음**이라 따로 받는다 —
   * 진행률은 업무를 들고 있는 사람이, 담당자는 일을 맡기는 사람이 손댄다
   * (`lib/domain/task-authoring.ts`). 여기서도 판정하지 않는다.
   */
  canAssign: boolean;
  /**
   * 맨 아래 [업무 삭제]를 그릴 것인가. **`canEdit`과 또 다른 물음**이라 따로 받는다 —
   * 부원은 자기 업무를 고치지만 지우지는 못한다 (`canDeleteTask`). 여기서도 판정하지 않고,
   * 실제 거부는 `DELETE`가 한다.
   */
  canDelete: boolean;
  /**
   * 볼 수는 있는데 손댈 수 없는 업무인가. **팀장이 전 팀을 보게 된 뒤로 생긴 상태다**
   * (`0012`) — 폼 셋이 통째로 사라진 화면은 고장과 구분되지 않으므로 한 줄로 사유를 적는다.
   * 판정은 여기서 하지 않고 `task-panel-slot.tsx`가 넘긴다.
   */
  readOnly: boolean;
  /** 왜 읽기 전용인가. 문구가 둘로 갈린다 (아래) */
  readOnlyReason: 'other-team' | 'not-mine';
  /** 이 업무의 팀 구성원. 페이지가 `assignableMembers`로 좁혀 넘긴다 */
  ownerCandidates: readonly OwnerCandidate[];
  statusOptions: readonly string[];
  /** 이 역할이 못 고치는 칸 (`lockedTaskFields`). 페이지가 계산해 넘긴다 */
  lockedFields: readonly string[];
}) {
  const router = useRouter();
  const closeRef = useRef<HTMLAnchorElement>(null);

  /*
   * **닫기는 기다리지 않는다.** 열림은 여전히 URL이지만(`?task=`), 닫을 때 서버 컴포넌트가
   * 다시 그려지기를 기다리면 패널이 화면에 남은 채 몇백 밀리초가 흐른다 — 이 화면은
   * `force-dynamic`이라 그 사이에 저장소 조회가 통째로 한 번 더 돈다.
   *
   * 그래서 지우는 것을 먼저 하고 주소를 그다음에 바꾼다. **되돌아올 상태가 없어서 안전하다**:
   * 이 컴포넌트는 `?task=`가 없으면 아예 마운트되지 않으므로(`task-panel-slot.tsx`), 이동이
   * 끝나면 어차피 사라진다. 뒤로 가기로 돌아오면 새 인스턴스가 `closing = false`로 뜬다.
   */
  const [closing, setClosing] = useState(false);

  const close = useCallback((): void => {
    setClosing(true);
    router.push(closeHref);
  }, [router, closeHref]);

  useEffect(() => {
    // 키보드로 표를 훑던 사람이 패널을 열면 포커스가 뒤에 남는다
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  if (closing) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* 오버레이는 불투명도만 쓴다. 흐림 효과는 안티패턴 1번이다 (`UI_GUIDE.md`) */}
      {/* 베일은 **어두운 쪽**이다. 라이트에서 `bg-canvas/70`(옅은 회색)을 덮으면 뒤 화면이
          뿌예지기만 하고 패널이 앞에 있다는 것이 읽히지 않는다 (`ADR-018`) */}
      {/* `href`를 남겨 두는 것은 가운데 클릭·주소 복사 때문이다. 보통의 클릭은 위 `close`가
          가로채 **먼저 지우고** 이동한다 */}
      <Link
        href={closeHref}
        aria-label="패널 닫기"
        onClick={(event) => {
          event.preventDefault();
          close();
        }}
        className="bg-ink/30 absolute inset-0"
      />

      <aside
        aria-label="업무 상세"
        className="border-line bg-panel relative z-10 h-full w-[660px] max-w-[92vw] overflow-y-auto rounded-none border-l"
        // keyframe은 `globals.css`에 있다. 이 화면의 유일한 애니메이션이다 (`UI_GUIDE.md`)
        style={{ animation: 'panel-slide-in 200ms ease-out' }}
      >
        <header className="border-line bg-panel sticky top-0 flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={task.displayStatus} />
              <span className="text-ink-muted text-xs">{teamLabel(task.teamId)}</span>
            </div>
            <h2 className="text-ink mt-2 text-sm font-semibold break-words">
              {text(task.title)}
            </h2>
          </div>
          <Link
            ref={closeRef}
            href={closeHref}
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
            className="border-line text-ink-muted hover:border-brand hover:text-brand rounded border px-2 py-1 text-xs"
          >
            닫기
          </Link>
        </header>

        <div className="space-y-6 px-5 py-4">
          {/*
           * **결재는 맨 위다.** 승인 대기함에서 이 패널로 옮긴 것은, 승인하려면 무엇을
           * 승인하는지 먼저 봐야 하기 때문이다 — 목록의 줄 옆에 버튼이 있으면 제목만 보고
           * 누르게 된다. 상태가 「승인 대기」인 업무에만, 고칠 수 있는 사람에게만 뜬다.
           */}
          {task.flags.semantic === 'approval' && canEdit && (
            <section className="border-brand bg-brand-soft rounded-md border px-3 py-3">
              <p className="text-brand text-sm font-semibold">승인 대기 중인 업무입니다</p>
              <p className="text-ink-body mt-1 text-xs">
                승인하면 「게시·이관 대기」로, 반려하면 「수정 중」으로 바뀝니다.
              </p>
              <div className="mt-2">
                <ApprovalActions taskId={task.id} defaultReason={task.delayReason ?? ''} />
              </div>
            </section>
          )}

          <TaskDetailFields
            task={task}
            cells={cells}
            extraFields={extraFields}
            canEdit={canEdit}
            canAssign={canAssign}
            statusOptions={statusOptions}
            ownerCandidates={ownerCandidates}
            lockedFields={lockedFields}
          />

          {readOnly && (
            /*
             * 색을 주지 않는다 — 문제가 아니라 **사실**이다 (`UI_GUIDE.md`). 사유가 둘이라
             * 문구도 둘이다: 팀장·어드민에게는 「다른 팀」이고, 부원에게는 「내 담당이 아닌
             * 팀원의 업무」다 (부원은 팀을 보되 자기 담당만 고친다 · `0015`).
             */
            <p className="border-line bg-raise text-ink-muted rounded border px-3 py-2 text-xs">
              {readOnlyReason === 'other-team'
                ? `다른 팀 업무라 읽기 전용입니다. 고치거나 지우는 것은 ${teamLabel(task.teamId)}에서 합니다.`
                : '내가 담당한 업무가 아니라 읽기 전용입니다. 담당자와 팀장이 고칩니다.'}
            </p>
          )}

          <section>
            <h3 className="text-brand text-sm font-semibold">단계</h3>
            {stages.length === 0 ? (
              <p className="text-ink-muted mt-2 text-xs">단계 정보가 없습니다</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {stages.map((stage) => (
                  <li key={stage.id} className="border-line rounded border p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink text-sm break-words">{stage.stageLabel}</span>
                      <span className="text-ink-faint text-xs whitespace-nowrap tabular-nums">
                        {stage.slaDays === null ? EMPTY : `SLA ${stage.slaDays}일`}
                      </span>
                    </div>
                    <dl className="mt-2">
                      <Row label="계획일" value={formatDate(stage.plannedDate)} />
                      <div className="border-line/60 grid grid-cols-[256px_1fr] gap-3 border-b py-1.5 text-sm">
                        <dt className="text-ink-muted text-xs">실제일</dt>
                        {/* 계획보다 늦은 **날짜 한 칸**만 색을 갖는다 */}
                        <dd
                          className={`tabular-nums ${isLate(stage) ? 'text-warn' : 'text-ink-body'}`}
                        >
                          {formatDate(stage.actualDate)}
                        </dd>
                      </div>
                      <Row label="확인 상태" value={text(stage.confirmStatus)} />
                      <Row label="내용" value={text(stage.content)} />
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h3 className="text-brand text-sm font-semibold">출처</h3>
            {/* 「시트 어디서 왔는가」가 이 화면 전체의 신뢰 근거다 */}
            <dl className="mt-2">
              <Row label="시트 탭" value={task.sourceSheetTab} />
              <Row label="행" value={String(task.sourceRowIndex)} />
            </dl>
          </section>

          {canDelete && (
            /*
             * **맨 아래다.** 이 패널을 여는 이유는 대부분 읽기이고, 되돌릴 수 없는 버튼이
             * 스크롤 중간에 서면 스치는 자리에 놓이게 된다 (`task-delete-button.tsx`).
             */
            <section className="border-line border-t pt-4">
              <TaskDeleteButton taskId={task.id} title={task.title} closeHref={closeHref} />
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
