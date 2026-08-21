/**
 * 시트 업로드 화면. **주간 루프의 진입점**이라 여기가 귀찮으면 시스템 전체가 죽는다 (T5 목적문).
 *
 * 서버 컴포넌트가 하는 일은 저장소 상태를 읽어 배너를 고르고 패널에 넘기는 것뿐이다.
 * `getStorage()`를 **직접** 부른다 — 자기 API를 `fetch`하면 불필요한 HTTP 왕복이 생긴다
 * (`ADR-007`).
 */

import { SheetUploadPanel } from '@/components/upload/sheet-upload-panel';
import { StorageBanner } from '@/components/upload/storage-banner';
import { getStorage } from '@/lib/store/store-factory';

/**
 * **정적 프리렌더를 막는다.** `getStorage()`의 결과(연결 성공/실패)는 빌드 시각이 아니라
 * 요청 시각의 사실이다. 프리렌더하면 배너가 빌드 때 상태로 굳어, 저장소가 죽어도 화면은
 * 「정상」이라고 말한다 — `ADR-005`가 막으려는 조용한 오해가 그대로 생긴다.
 */
export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const { readOnly, mode } = await getStorage();

  return (
    <main className="flex-1 bg-neutral-50">
      <StorageBanner mode={mode} />

      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <h1 className="text-xl font-semibold text-neutral-900">시트 업로드</h1>
        <p className="mt-1 text-sm text-neutral-700">
          Google Sheets에서 내보낸 .xlsx를 올리면 신규·변경·유지 건수를 먼저 보여 줍니다.
        </p>

        <div className="mt-6">
          <SheetUploadPanel readOnly={readOnly} mode={mode} />
        </div>
      </div>
    </main>
  );
}
