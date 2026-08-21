/** 업로드 경로는 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse } from '@/lib/api/api-error';
import { getStorage } from '@/lib/store/store-factory';
import { commitUpload } from '@/lib/upload/upload-commit';
import { buildSeedPayload } from '@/lib/upload/seed-loader';

/**
 * 빈 상태 화면의 `[샘플 데이터 불러오기]`가 부르는 자리. **이것은 쓰기다** —
 * 그래서 읽기 전용 모드에서는 서버가 거부한다. UI 비활성만으로는 방어가 아니다 (`ADR-005`).
 *
 * **시드 전용 쓰기 경로를 만들지 않았다.** `uploads` 행을 만들고 `commitUpload`로 확정하는
 * 순서가 실제 시트 업로드와 **완전히 같다**. 다른 코드가 데이터를 만들면 "가짜 UI가 아니라
 * 파싱 로직이 실제로 돈다"는 시연 근거(`PLAN.md` 9-3)가 무너진다. 부수 효과로 **두 번 눌러도
 * 안전하다** — 확정이 멱등이라 두 번째는 전건 `unchanged`가 된다 (`X4`).
 *
 * 계산은 없다. 시각을 만들고, `lib/`을 순서대로 부르고, 결과를 그대로 직렬화한다.
 */
export async function POST(): Promise<Response> {
  try {
    const storage = await getStorage();
    // 저장소를 건드리기 **전에** 막는다. 폴백 중 쓰기는 재시작 때 조용히 사라진다
    if (storage.readOnly) return errorResponse('STORAGE_READONLY');

    const now = new Date().toISOString();
    const record = await storage.uploads.create({
      kind: 'sheet',
      // 파일이 아니라 저장소 안의 픽스처다. 사용자가 준 문자열이 아니므로 되돌려줘도 안전하다
      filename: 'seed-tasks.json',
      parseResult: buildSeedPayload(),
      createdAt: now,
    });

    const outcome = await commitUpload(
      { repo: storage.repo, uploads: storage.uploads, readOnly: storage.readOnly },
      record.id,
      now,
    );
    if (!outcome.ok) return errorResponse(outcome.code, outcome.message);

    return Response.json({ upload: { id: record.id, status: 'done' }, summary: outcome.summary });
  } catch {
    // 예상 못 한 예외를 여기서 접는다. **메시지를 응답에 넣지 않는다** (`X1`)
    return errorResponse('STORAGE_UNAVAILABLE');
  }
}
