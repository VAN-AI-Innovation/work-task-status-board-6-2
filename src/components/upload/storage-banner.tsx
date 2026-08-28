/**
 * 저장소 모드 고지 배너. `/upload`와 `/`가 **같은 문구·같은 색**을 써야 해서 한 곳에 둔다 —
 * 문자열을 두 화면에 복사하면 한쪽만 고쳐졌을 때 사용자가 장애를 데모로 읽는다.
 *
 * 두 문구를 **절대 섞지 않는다**: 하나는 사고(`fallback`)고 하나는 의도(`demo`)다
 * (`ADR-005`·`UI_GUIDE.md`「배너」).
 */

import type { StorageMode } from '@/lib/store/store-factory';

export function StorageBanner({ mode }: { mode: StorageMode }) {
  if (mode === 'fallback') {
    return (
      <div className="border-b border-warn-line bg-warn-bg px-6 py-2 text-sm text-warn print:hidden">
        읽기 전용 — 저장소 연결 실패
      </div>
    );
  }

  if (mode === 'demo') {
    return (
      <div className="border-b border-line bg-raise px-6 py-2 text-sm text-ink-muted print:hidden">
        샘플 데이터 모드
      </div>
    );
  }

  return null;
}
