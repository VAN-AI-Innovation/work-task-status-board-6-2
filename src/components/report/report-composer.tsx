'use client';

/**
 * 팀장의 `/report` 화면에서 **제출 칸과 보고 본문을 한 상태로 묶는다.**
 *
 * ## 왜 생겼나
 *
 * 예전에는 「어드민에게 보고」 패널이 본문 상태를 혼자 들고 있었고, 그 아래 「보고 본문」
 * 문서는 서버가 계산한 문자열을 그렸다. 그래서 팀장이 위에서 한 줄을 고쳐도 아래 문서는
 * 그대로였다 — **같은 화면에 같은 이름의 문서가 둘 있고 내용이 다른 상태**다. 그 화면에서
 * 「PDF로 저장」을 누르면 올린 것과 다른 문서가 나오고, 그것은 회의 자리에서야 드러난다.
 *
 * 그래서 상태를 여기로 올린다. 아래 문서가 그리는 것은 **지금 [보고 보내기]를 누르면
 * 올라갈 바로 그 문자열**이고, 복사·내려받기·PDF도 같은 것을 낸다.
 *
 * ## 서버가 계산한 것을 여기서 다시 계산하지 않는다
 *
 * `computed`는 `buildWeeklyReport`가 만든 문자열 그대로 내려온 것이고, 이 컴포넌트는 그것을
 * **초기값과 「되돌리기」의 목적지**로만 쓴다 (`ADR-006`). 특이사항을 본문에 끼워 넣지도
 * 않는다 — 팀별 문서를 합치면서 특이사항을 앞에 세우는 것은 어드민 화면의 일이고
 * (`report-merge.ts`), 여기서 흉내 내면 병합 규칙이 두 벌이 된다.
 *
 * ## 제출본이 있으면 그것으로 연다
 *
 * 계산본으로 열면 팀장이 지난번에 고쳐 넣은 문장이 화면에서 사라지고, 그 상태로 다시
 * 보내면 조용히 지워진다. (이 판단은 원래 `report-submit-panel.tsx`에 있던 것이다 —
 * 상태와 함께 이 파일로 올라왔다.)
 *
 * **주가 바뀌면 다시 연다.** 기간 이동은 서버 라우팅이라 이 컴포넌트가 새로 마운트되는
 * 것이 보통이지만, React가 같은 자리를 재사용하면 지난주 본문이 이번 주 칸에 남는다.
 * `key`를 페이지가 주지 않아도 되도록 `weekStart`를 상태에 함께 담아 스스로 알아챈다.
 */

import { useState } from 'react';

import { ReportDocument } from '@/components/report/report-document';
import { ReportSubmitPanel } from '@/components/report/report-submit-panel';
import type { ReportStatus } from '@/lib/domain/report-submission';

export function ReportComposer({
  weekStart,
  computed,
  submittedBody,
  submittedNote,
  status,
  reviewNote,
  submittedOn,
  filename,
}: {
  weekStart: string;
  /** 지금 데이터로 계산한 본문 (`buildWeeklyReport`) */
  computed: string;
  /** 이미 올린 본문. 없으면 `null`이고 그때는 계산본으로 시작한다 */
  submittedBody: string | null;
  submittedNote: string;
  status: ReportStatus | null;
  reviewNote: string | null;
  submittedOn: string | null;
  /** `.md` 내려받기 파일명. 주가 들어 있으므로 페이지가 만든다 */
  filename: string;
}) {
  const [draft, setDraft] = useState({
    week: weekStart,
    body: submittedBody ?? computed,
    note: submittedNote,
  });

  /*
   * 주가 바뀌었는데 같은 인스턴스가 남아 있다면 **이번 주 값으로 갈아 끼운다.** 렌더 중에
   * `setState`를 부르는 것은 React가 문서로 권하는 「props 변화에 맞춰 상태를 조정하는」
   * 형태이고(그 자리에서 다시 렌더할 뿐 화면에 옛 값이 나가지 않는다), `useEffect`로 하면
   * 지난주 본문이 한 프레임 보인다.
   */
  if (draft.week !== weekStart) {
    setDraft({ week: weekStart, body: submittedBody ?? computed, note: submittedNote });
  }

  return (
    <>
      <div className="mt-6">
        <ReportSubmitPanel
          weekStart={weekStart}
          computed={computed}
          body={draft.body}
          note={draft.note}
          onBodyChange={(body) => setDraft((prev) => ({ ...prev, body }))}
          onNoteChange={(note) => setDraft((prev) => ({ ...prev, note }))}
          status={status}
          reviewNote={reviewNote}
          submittedOn={submittedOn}
        />
      </div>

      {/* 위 칸이 들고 있는 **바로 그 문자열**이다. 복사·내려받기·PDF가 전부 이것을 낸다 */}
      <div className="mt-4">
        <ReportDocument markdown={draft.body} filename={filename} />
      </div>
    </>
  );
}
