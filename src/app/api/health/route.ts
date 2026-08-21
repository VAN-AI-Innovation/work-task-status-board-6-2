/** ExcelJS·mammoth가 Node 내장 모듈을 쓴다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { getStorage } from '@/lib/store/store-factory';

/**
 * 저장소가 지금 어느 모드인지만 보고한다. **비밀·키·프로젝트 URL을 절대 싣지 않는다** —
 * 이 라우트는 인증 없이 열려 있다.
 */
export async function GET(): Promise<Response> {
  const storage = await getStorage();

  return Response.json({
    ok: true,
    driver: storage.driver,
    mode: storage.mode,
    readOnly: storage.readOnly,
    lastSyncedAt: await storage.repo.getLastSyncedAt(),
  });
}
