import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// tsconfig의 paths를 Vitest가 자동으로 읽지 않는다 (PLAN.md A6).
// 새 의존성 없이 별칭을 직접 지정한다.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
