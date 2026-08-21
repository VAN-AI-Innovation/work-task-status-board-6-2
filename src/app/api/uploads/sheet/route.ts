/** ExcelJS가 Node 내장 모듈을 쓴다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse } from '@/lib/api/api-error';
import { kstToday } from '@/lib/domain/kst-today';
import { getStorage } from '@/lib/store/store-factory';
import { runWorkbookParse } from '@/lib/upload/parse-runner';
import { checkUpload } from '@/lib/upload/upload-guard';
import { WORKBOOK_LIMITS } from '@/lib/upload/upload-limits';
import { buildUploadPreview } from '@/lib/upload/upload-preview';

/**
 * 파일 → 미리보기. **저장소에는 `uploads` 행 하나만 쓴다** — 태스크는 확정(`ADR-008`) 전까지
 * 한 건도 쓰지 않는다.
 *
 * 이 파일에 계산이 없다는 것이 T5 완료 기준 1이다. 하는 일은 넷뿐이다:
 * 요청에서 바이트를 꺼내고, 시각을 만들고, `lib/`을 순서대로 부르고, 결과를 그대로 직렬화한다.
 *
 * 시각을 **여기서** 읽는다. 시계를 읽는 것은 요청 경계의 일이고, 그 아래 계층은 전부 주입받는다
 * (`CLAUDE.md` CRITICAL의 대상은 도메인 함수다).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const storage = await getStorage();
    // 저장소를 건드리기 **전에** 막는다. 폴백 중 쓰기는 재시작 때 조용히 사라진다 (`ADR-005`)
    if (storage.readOnly) return errorResponse('STORAGE_READONLY');

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return errorResponse('VALIDATION_FAILED');

    // 뷰 하나로 둘을 쓴다 — 문지기는 바이트를 훑고(`Uint8Array`), 파서는 버퍼를 받는다. 복사 없음
    const buffer = await file.arrayBuffer();
    const checked = checkUpload({
      filename: file.name,
      bytes: new Uint8Array(buffer),
      expect: 'sheet',
    });
    if (!checked.ok) return errorResponse(checked.code, checked.message);

    const now = new Date();
    const parsed = await runWorkbookParse(buffer, {
      baseYear: Number(kstToday(now).slice(0, 4)),
      limits: WORKBOOK_LIMITS,
    });
    if (!parsed.ok) return errorResponse(parsed.code, parsed.message);

    // 대조용 읽기다. 쓰기가 아니다 — 「신규/변경/유지」의 모수를 미리보기에 넘긴다
    const existing = await storage.repo.listTasks();
    const preview = buildUploadPreview(parsed.result, existing, null);
    if (!preview.ok) return errorResponse(preview.code, preview.message);

    // 행은 **미리보기 성공 후에만** 만든다. 거부·파싱 실패에 행을 남기면 테이블에 쓰레기가
    // 쌓이고, 그 행에 개인정보가 든 `parse_result`가 함께 남는다 (`S6`).
    const record = await storage.uploads.create({
      kind: 'sheet',
      filename: file.name,
      parseResult: preview.payload,
      createdAt: now.toISOString(),
    });

    return Response.json({
      upload: { id: record.id, status: record.status, filename: record.filename },
      preview: preview.preview,
    });
  } catch {
    // 예상 못 한 예외를 여기서 접는다. **메시지를 응답에 넣지 않는다** (`X1`)
    return errorResponse('STORAGE_UNAVAILABLE');
  }
}
