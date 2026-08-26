import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// tsconfig의 paths를 Vitest가 자동으로 읽지 않는다 (PLAN.md A6).
// 새 의존성 없이 별칭을 직접 지정한다.
//
// `.env.local`도 Vitest가 자동으로 읽지 않는다. Supabase 계약 테스트(step 9)가 실제 저장소에
// 붙으려면 키가 `process.env`에 있어야 하므로 Vite의 `loadEnv`로 채운다.
// **없어도 실패시키지 않는다** — 메모리 드라이버만 쓰는 개발자가 테스트를 못 돌리면 안 된다.
// 값이 없으면 계약 스위트가 `it.skip`으로 스스로 흔적을 남긴다.
//
// `SKIP_LIVE_DB=1`이면 **읽지 않는다.** 원래는 이슈 #20(원격에 실업무 행이 한 줄만 있어도
// 계약이 전체 건수 단언에서 무너지는 것)의 우회로였다. 그 원인은 `ADR-023`(계약이 자기 행만
// 센다)으로 사라졌고, 이제 이 스위치는 **네트워크 없이·원격을 건드리지 않고** 돌리고 싶을
// 때만 쓴다. 자격증명을 주지 않으면 스위트가 스스로 `it.skip`으로 흔적을 남기므로
// 「조용히 0건 통과」가 되지 않는다.
//
// **기본값은 「돈다」다.** 실측(2026-08-27, 깨끗한 셸. 원격에 실업무 행 1건이 있는 상태):
//   `npx vitest run src/lib/store/supabase-task-store.test.ts`        → 44건 전부 통과(라이브)
//   `SKIP_LIVE_DB=1 npx vitest run …supabase-task-store.test.ts`      → 계약 스위트 skip
// 즉 아래 `process.env` 대입은 워커에 정상 전달된다.
// (`ADR-023` 전에는 같은 명령이 43건 중 10건 실패였다.)
//
// ⚠ **재는 셸에 `SKIP_LIVE_DB`가 남아 있는지 먼저 확인하라.** 하네스를 `SKIP_LIVE_DB=1`로
// 돌리면 그 자식 세션이 값을 물려받아, 「스위치 없이 돌렸다」고 믿으면서 실제로는 켠 채로
// 재게 된다. T7 감사에서 실제로 그렇게 재어 「스위치가 무의미하다」는 잘못된 결론이 났다.
const env = process.env.SKIP_LIVE_DB === '1' ? {} : loadEnv('', process.cwd(), '');
for (const name of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]) {
  if (env[name] && !process.env[name]) {
    process.env[name] = env[name];
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 계약 테스트 한 건은 Supabase에 여러 번 왕복한다. 기본 5초로는 네트워크가 조금만
    // 느려도 실패가 통과 여부와 무관해진다.
    testTimeout: 30_000,
  },
});
