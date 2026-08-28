'use client';

/**
 * 사이드 패널의 **담당자 지정·재지정** 폼. `task-edit-form.tsx`의 형제이고 규율이 전부 같다 —
 * 서버가 준 문구를 그대로 띄우고, 낙관적 업데이트를 하지 않으며, 성공한 뒤에야
 * `router.refresh()`로 서버 컴포넌트를 다시 그린다.
 *
 * ## 폼을 둘로 나눈 이유
 *
 * 업무 내용 수정과 한 폼에 묶지 않았다. **누가 쓰는지가 다르다** — 진행 상황은 그 업무를
 * 들고 있는 사람이 적고(`canEditTaskDetails`), 담당자는 일을 맡기는 사람이 정한다
 * (`canAssignOwner`). 한 폼이면 부원에게 담당자 칸이 딸려 온다.
 *
 * ## 후보를 화면이 고르지 않는다
 *
 * `candidates`는 페이지가 `assignableMembers`로 좁혀 넘긴다 — 그 업무의 팀 사람만 선다.
 * 여기서 다시 거르면 규칙이 두 벌이 되고, 그 두 벌은 라우트(`PATCH`)가 보는 것과 또 갈린다.
 *
 * ## 「담당자 없음」은 고를 수 있다
 *
 * `null`을 보내는 선택지를 둔다. 잘못 지정한 것을 되돌릴 방법이 없으면 사람은 아무 이름이나
 * 남겨 두고, 그러면 「담당자 미지정」 알림이 영원히 0건이 된다.
 *
 * ## 담당자는 여럿일 수 있다. 다만 **주 담당은 하나다**
 *
 * 드롭다운 하나(주 담당) + 체크박스 여럿(공동 담당)이다. 평평한 다중 선택으로 두고 「첫
 * 번째가 주 담당」이라고 하면, 목록에서 순서를 바꾸는 것만으로 **누가 그 업무를 자기 화면에서
 * 보는지가 조용히 바뀐다** — 부원의 열람 범위는 주 담당 하나로 정해진다(`viewer-scope.ts`).
 * 시트도 「담당자」와 「공동 담당」 두 칸으로 같은 구분을 하고 있다.
 *
 * ⚠ **공동 담당자도 이제 자기 화면에서 이 업무를 본다** (`0013_task_authoring.sql`). 오래도록
 * 반대였고 화면이 그 사실을 한 줄로 적고 있었는데, 「지정했는데 그 사람 화면에는 안 뜬다」는
 * 것이 지정 기능의 쓸모를 절반 지웠다. 판정은 **이름 + 팀**으로 한다 (`viewer-scope.ts`) —
 * `co_owner_names`가 이름 배열이라 id로는 맞춰 볼 것이 없기 때문이고, 동명이인은 팀 대조로
 * 막는다.
 *
 * 주 담당으로 고른 사람은 **공동 담당 목록에서 사라진다.** 한 사람이 두 칸에 동시에 설 수
 * 없다는 것은 규칙이지 상태가 아니라서, 흐리게 남겨 두면 「고를 수 있는데 왜 흐리지」로
 * 읽힌다. 그래도 **보내는 값에서 겹침을 지우는 것은 서버다** — 주 담당을 바꾸는 순간
 * 체크되어 있던 사람이 그대로 남는 찰나가 있고, 그 정리를 화면이 지면 규칙이 두 곳이 된다.
 *
 * ⚠ **다음 업로드가 이 값을 덮어쓴다.** 시트가 진실의 원천이라는 규칙 그대로이고
 * (`ADR-001`), 그래서 화면이 그 사실을 한 줄로 적는다 — 적지 않으면 사용자는 시트를 올린
 * 뒤 자기 지정이 사라진 것을 사고로 읽는다.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { ApiErrorBody } from '@/types/api';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 「담당자 없음」. 빈 문자열이라 `members.id`(uuid)와 섞이지 않는다 */
const UNASSIGNED = '';

export interface OwnerCandidate {
  id: string;
  name: string;
}

export function OwnerAssignForm({
  taskId,
  ownerMemberId,
  coOwnerNames,
  candidates,
}: {
  taskId: string;
  /** 지금 담당자. 시트 이름이 명부에 안 붙었으면 `null`이다 */
  ownerMemberId: string | null;
  /** 지금 공동 담당 **이름들**. 저장소에 이름으로 들어 있다 (`tasks.co_owner_names`) */
  coOwnerNames: readonly string[];
  /** 이 업무의 팀 구성원. 페이지가 `assignableMembers`로 좁혀 넘긴다 */
  candidates: readonly OwnerCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
   * 현재 담당자가 후보에 없을 수 있다 — 시트 이름이 명부에 안 붙은 업무이거나, 명부에서
   * 빠진 사람이다. 그때 후보의 첫 값을 고른 것처럼 그리면 **저장하지도 않은 사람이 현재
   * 담당자로 보인다** (`task-edit-form.tsx`가 상태에서 같은 판단을 한다).
   */
  const current =
    ownerMemberId !== null && candidates.some((item) => item.id === ownerMemberId)
      ? ownerMemberId
      : UNASSIGNED;
  const [choice, setChoice] = useState(current);

  /* 지금 공동 담당. 이름으로 들어오므로 명부에서 **id로 되찾는다** — 명부에 없는 이름
     (시트에서 온 자유 입력)은 되찾을 수 없어 빠지고, 저장하면 그 이름은 사라진다.
     그 사실도 아래에 적는다 */
  const currentCoOwners = candidates
    .filter((item) => coOwnerNames.includes(item.name))
    .map((item) => item.id);
  const [coChoice, setCoChoice] = useState<string[]>(currentCoOwners);

  /** 명부에서 되찾지 못한 이름. 저장하면 사라지는 값이라 미리 말한다 */
  const orphanNames = coOwnerNames.filter(
    (name) => !candidates.some((item) => item.name === name)
  );

  const busy = sending || pending;
  const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && [...left].sort().join() === [...right].sort().join();
  const unchanged = choice === current && sameSet(coChoice, currentCoOwners);

  /*
   * **주 담당은 이 목록에서 뺀다.** 흐리게 두고 남겨 봤더니 「고를 수 있는데 왜 흐리지」로
   * 읽혔다 — 한 사람이 두 칸에 동시에 설 수 없다는 것은 규칙이지 상태가 아니고, 규칙은
   * 자리를 차지하지 않는 편이 낫다. 주 담당을 바꾸면 이 목록이 그 자리에서 다시 그려진다.
   */
  const coCandidates = candidates.filter(
    (candidate) => choice === UNASSIGNED || candidate.id !== choice
  );

  const toggleCoOwner = (id: string): void => {
    setCoChoice((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  async function save(): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        /*
         * 빈 값은 「담당자를 비운다」다 — 서버도 `null`을 그 뜻으로 받는다.
         *
         * 둘을 **함께** 보낸다. 따로 보내면 주 담당을 바꾼 요청과 공동 담당을 바꾼 요청
         * 사이에 「같은 사람이 두 칸에 있는」 순간이 생기고, 그 사이에 화면을 새로 그리면
         * 사용자는 자기가 만들지 않은 상태를 본다. 겹침 제거는 서버가 한 번에 한다
         */
        body: JSON.stringify({
          ownerMemberId: choice === UNASSIGNED ? null : choice,
          coOwnerMemberIds: coChoice,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(body?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      // 값을 여기서 갈아 끼우지 않는다 — 서버 컴포넌트가 다시 그린 것이 진실이다
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  if (candidates.length === 0) {
    /*
     * 고를 사람이 없다. **빈 드롭다운을 그리지 않는다** — 열어 봐야 아무것도 없는 칸은
     * 고장으로 읽힌다. 원인은 하나뿐이라(그 팀 명부가 비었다) 그것을 적는다.
     */
    return (
      <p className="text-ink-muted text-xs">
        이 팀의 시트 명부가 비어 있어 고를 담당자가 없습니다. 시트를 올리면 후보가 생깁니다.
      </p>
    );
  }

  return (
    <div className="border-line rounded border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-ink-muted text-xs">담당자</span>
          <select
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            disabled={busy}
            className="border-line bg-panel text-ink focus:border-brand rounded border px-3 py-2 text-sm focus:outline-none"
          >
            <option value={UNASSIGNED}>담당자 없음</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || unchanged}
          className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
            busy || unchanged ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
          }`}
        >
          {busy ? '저장 중…' : '지정'}
        </button>
      </div>

      {/* 공동 담당. 드롭다운을 하나 더 두지 않는 이유는 **여럿을 한눈에 켜고 끄는** 자리이기
          때문이다 — 다중 선택 `<select>`는 Ctrl+클릭을 알아야 쓸 수 있다 */}
      <fieldset className="mt-4">
        <legend className="text-ink-muted text-xs">공동 담당</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {coCandidates.length === 0 ? (
            <span className="text-ink-muted text-xs">고를 사람이 더 없습니다</span>
          ) : (
            coCandidates.map((candidate) => (
              <label key={candidate.id} className="text-ink-body flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={coChoice.includes(candidate.id)}
                  onChange={() => toggleCoOwner(candidate.id)}
                  disabled={busy}
                  className="accent-[var(--color-brand)]"
                />
                {candidate.name}
              </label>
            ))
          )}
        </div>
      </fieldset>

      <p className="text-ink-muted mt-3 text-xs">
        공동 담당자의 화면에도 이 업무가 뜨고, 업무 표의 담당자 칸에 함께 적힙니다. 다음
        시트 업로드가 두 칸을 시트의 값으로 되돌립니다.
      </p>

      {orphanNames.length > 0 && (
        // 명부에 없는 이름을 **조용히 지우지 않는다.** 저장이 무엇을 없애는지 미리 말한다
        <p className="text-warn mt-2 text-xs">
          지금 공동 담당 중 {orphanNames.length}명은 시트 명부에 없는 이름이라 아래 목록에
          없습니다. 저장하면 그 이름은 사라집니다.
        </p>
      )}

      {message !== null && <p className="text-late mt-3 text-sm">{message}</p>}
    </div>
  );
}
