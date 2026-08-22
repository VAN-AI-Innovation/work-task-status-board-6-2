'use client';

/**
 * 업무 상세 사이드 패널. **촬영·기획팀 70컬럼을 쓸 수 있게 만드는 것이 이 화면이다**
 * (`ADR-002`·`UC-15`) — 표는 공통 8칸만 뿌리기로 했으므로 나머지 60여 칸이 보이는 자리는
 * 여기뿐이다. 그래서 `extras`를 **개수 제한 없이 전량** 나열한다. 접거나 「더 보기」로
 * 숨기면 그 팀의 데이터는 다시 화면에서 사라진다.
 *
 * ## 여는 것도 닫는 것도 URL이다
 *
 * `?task=<id>`가 열림이고, 닫기는 그 키를 지운 링크로 **이동**한다. Esc·오버레이 클릭·
 * 닫기 버튼 셋이 전부 같은 이동이다. 클라이언트 상태로 열면 딥링크(완료 기준 6)와
 * 뒤로 가기가 죽는다 — 링크를 받은 사람이 패널이 닫힌 화면을 보게 된다.
 *
 * 슬라이딩을 `transition`이 아니라 keyframe으로 두는 것도 같은 이유다. 패널은 열릴 때
 * **마운트**되므로 옮겨갈 이전 상태가 없다. 시작 위치를 `useState`로 한 번 푸는 방법도
 * 있지만, 그러면 패널이 열림 여부를 자기 상태로 들고 있는 것처럼 읽힌다.
 *
 * ## 마스킹을 여기서 하지 않는다
 *
 * `cells`는 서버가 `toExtraCells`로 만들어 넘긴다. 민감 값은 그 전에 이미 응답 계층이
 * 지웠다 (`S6`) — 패널은 그 `null`이 「가려진 것」인지 「원래 없는 것」인지 표시만 한다.
 * 링크도 마찬가지로 `href`가 있을 때만 앵커다 (`S7` — 판정은 `safeHref`가 이미 했다).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { StatusBadge } from '@/components/tasks/status-badge';
import type { ExtraCell } from '@/lib/view/extras-render';
import { EMPTY, formatDate, formatDday, formatPercent } from '@/lib/view/kpi-format';
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
  return (
    <div className="border-line/60 grid grid-cols-[140px_1fr] gap-3 border-b py-1.5 text-sm">
      <dt className="text-ink-muted text-xs break-words">{label}</dt>
      <dd className={`break-words ${faint === true ? 'text-ink-faint' : 'text-ink-body'}`}>
        {href === undefined || href === null ? (
          value
        ) : (
          // 스킴 검사를 통과한 링크만 여기 온다. 외부로 나가므로 opener를 끊는다 (`S7`)
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline-offset-4 hover:underline"
          >
            {value}
          </a>
        )}
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
  closeHref,
}: {
  task: TaskResponse;
  stages: TaskStage[];
  cells: ExtraCell[];
  closeHref: string;
}) {
  const router = useRouter();
  const closeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    // 키보드로 표를 훑던 사람이 패널을 열면 포커스가 뒤에 남는다
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') router.push(closeHref);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router, closeHref]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* 오버레이는 불투명도만 쓴다. 흐림 효과는 안티패턴 1번이다 (`UI_GUIDE.md`) */}
      <Link href={closeHref} aria-label="패널 닫기" className="bg-canvas/70 absolute inset-0" />

      <aside
        aria-label="업무 상세"
        className="border-line bg-panel relative z-10 h-full w-[480px] overflow-y-auto rounded-none border-l"
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
            className="border-line text-ink-muted hover:bg-raise hover:text-ink rounded border px-2 py-1 text-xs"
          >
            닫기
          </Link>
        </header>

        <div className="space-y-6 px-5 py-4">
          <section>
            <h3 className="text-ink text-sm font-semibold">기본</h3>
            <dl className="mt-2">
              <Row label="담당자" value={text(task.ownerNameRaw)} />
              <Row
                label="공동 담당"
                value={task.coOwnerNames.length === 0 ? EMPTY : task.coOwnerNames.join(', ')}
              />
              {/* 시트 원문 그대로다. 5색은 위 배지가 말한다 (`ADR-009`) */}
              <Row label="상태 (시트 원문)" value={text(task.status)} />
              <Row label="승인" value={text(task.approvalStatus)} />
              <Row label="우선순위" value={text(task.priority)} />
              <Row label="리스크" value={text(task.riskStatus)} />
              <Row label="진행률" value={formatPercent(task.progress)} />
              <Row label="배정일" value={formatDate(task.assignedAt)} />
              <Row label="마감" value={formatDate(task.dueAt)} />
              <Row label="D-DAY" value={formatDday(task.flags.dday)} />
              <Row label="다음 조치" value={text(task.nextAction)} />
              <Row label="다음 조치 담당" value={text(task.nextActionOwner)} />
              <Row label="다음 조치 기한" value={formatDate(task.nextActionDue)} />
              <Row label="지연 사유" value={text(task.delayReason)} />
              <Row label="비고" value={text(task.note)} />
            </dl>
          </section>

          <section>
            <h3 className="text-ink text-sm font-semibold">단계</h3>
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
                      <div className="border-line/60 grid grid-cols-[140px_1fr] gap-3 border-b py-1.5 text-sm">
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
            <h3 className="text-ink text-sm font-semibold">
              팀 전용 필드
              <span className="text-ink-muted ml-2 text-xs font-normal tabular-nums">
                {cells.length}칸
              </span>
            </h3>
            {cells.length === 0 ? (
              <p className="text-ink-muted mt-2 text-xs">팀 전용 필드가 없습니다</p>
            ) : (
              // **전량이다.** 개수를 자르면 70컬럼 팀의 데이터가 화면에서 사라진다
              <dl className="mt-2">
                {cells.map((cell) => (
                  <Row
                    key={cell.label}
                    label={cell.label}
                    value={cell.text}
                    href={cell.href}
                    faint={cell.masked}
                  />
                ))}
              </dl>
            )}
          </section>

          <section>
            <h3 className="text-ink text-sm font-semibold">출처</h3>
            {/* 「시트 어디서 왔는가」가 이 화면 전체의 신뢰 근거다 */}
            <dl className="mt-2">
              <Row label="시트 탭" value={task.sourceSheetTab} />
              <Row label="행" value={String(task.sourceRowIndex)} />
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}
