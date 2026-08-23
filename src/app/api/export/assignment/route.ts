/** ExcelJS가 Node 내장 모듈을 쓴다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { assignmentExportSchema, safeDownloadFilename } from '@/lib/api/assignment-schema';
import { buildAssignmentWorkbook } from '@/lib/xlsx/assignment-writer';

/**
 * 배정표 행 → xlsx 바이트. **저장소를 부르지 않는다** (`ADR-022`·결정 C) — 추출 경로에는
 * 확정할 저장소가 없고, `uploads` 행을 만들면 문서 본문이 통째로 남는다(`S6`).
 *
 * 이 라우트가 **새로 지는 판단은 헤더뿐**이다. 모양·규모의 방어는 `assignment-schema`가
 * 문 앞에서, 내용(`=`로 시작하는 셀)의 방어는 `assignment-writer`가 쓰기 한 곳에서 진다
 * (`ADR-012`). 여기서 셀을 손보기 시작하면 방어가 두 벌이 되고, 두 벌이 되는 순간 한쪽만
 * 고쳐지는 날이 온다.
 */

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 파일명을 주지 않았을 때. 받는 사람이 무엇인지 알 수 있으면 되고 날짜를 붙이지 않는다 */
const FALLBACK_FILENAME = 'assignment.xlsx';

/**
 * ASCII `filename`과 `filename*`을 **둘 다** 준다 (RFC 6266).
 *
 * 한글 파일명을 `filename="배정표.xlsx"`에 그대로 넣으면 헤더 값이 비-ASCII가 되어 받는
 * 쪽마다 다르게 깨진다. 그렇다고 `filename*`만 주면 그것을 모르는 오래된 클라이언트가
 * 이름을 잃는다. 그래서 ASCII 자리에는 **고정 대체값**을, `filename*`에는 퍼센트 인코딩한
 * 실제 이름을 싣는다 — 인코딩을 거치면 개행·따옴표가 남을 수 없다.
 */
function contentDisposition(filename: string): string {
  return `attachment; filename="${FALLBACK_FILENAME}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function POST(request: Request): Promise<Response> {
  // 본문이 JSON이 아닌 것은 **보낸 쪽의 잘못**이다. 아래 `catch`에 맡기면 `toApiErrorCode`가
  // 모르는 예외로 보고 503을 내는데, 이 라우트에는 불러올 저장소 자체가 없다
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('VALIDATION_FAILED');
  }

  try {
    const { rows, filename } = assignmentExportSchema.parse(body);

    const bytes = await buildAssignmentWorkbook(rows);

    // `Blob`으로 감싼다. `Uint8Array`를 그대로 넘기면 `BodyInit`이 아니고, `.buffer`를 넘기면
    // 뷰가 더 큰 버퍼의 일부일 때 그 뒤까지 실린다
    return new Response(new Blob([Uint8Array.from(bytes)]), {
      headers: {
        'Content-Type': XLSX_CONTENT_TYPE,
        'Content-Disposition': contentDisposition(
          safeDownloadFilename(filename, FALLBACK_FILENAME),
        ),
        // 사람 이름이 든 파일이다. 중간 캐시·브라우저 디스크에 남기지 않는다 (`S6`)
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    // 스키마 거부는 400, 그 밖은 우리 쪽 문제다. **예외 메시지를 응답에 넣지 않는다** (`X1`)
    return errorResponse(toApiErrorCode(error));
  }
}
