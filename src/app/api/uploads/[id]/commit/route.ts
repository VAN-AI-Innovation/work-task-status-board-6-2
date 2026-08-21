/** 업로드 경로는 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse } from '@/lib/api/api-error';
import { getStorage } from '@/lib/store/store-factory';
import { commitUpload } from '@/lib/upload/upload-commit';

/**
 * 미리보기를 저장소에 반영한다. **본문을 읽지 않는다** — 부분 업로드는 「파일에 든 탭만 반영」
 * 이지 「사용자가 탭을 고른다」가 아니다 (`UC-04`). 본문을 받기 시작하면 스펙이 늘어난다.
 *
 * 읽기 전용 판정·상태 전이·원자성은 전부 `commitUpload`가 진다. 여기서는 id를 꺼내고
 * 시각을 만들어 넘긴 뒤 결과를 옮겨 담는다.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // Next 16에서 동적 세그먼트 `params`는 Promise다
    const { id } = await params;
    const storage = await getStorage();

    const outcome = await commitUpload(
      { repo: storage.repo, uploads: storage.uploads, readOnly: storage.readOnly },
      id,
      new Date().toISOString(),
    );
    if (!outcome.ok) return errorResponse(outcome.code, outcome.message);

    return Response.json({ upload: { id, status: 'done' }, summary: outcome.summary });
  } catch {
    return errorResponse('STORAGE_UNAVAILABLE');
  }
}
