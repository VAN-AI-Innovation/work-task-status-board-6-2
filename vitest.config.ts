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
const env = loadEnv('', process.cwd(), '');
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
