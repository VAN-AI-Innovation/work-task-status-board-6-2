import { describe, expect, it } from 'vitest';

import { findServiceRoleViolations } from '@/lib/env-guard';

describe('findServiceRoleViolations', () => {
  it('NEXT_PUBLIC_ 접두사가 붙은 service_role 키를 잡는다', () => {
    const violations = findServiceRoleViolations([
      {
        path: '.env.local',
        content: 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.secret',
      },
    ]);

    expect(violations).toEqual([
      { file: '.env.local', line: 1, name: 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY' },
    ]);
  });

  it('중간 토큰 없는 NEXT_PUBLIC_SERVICE_ROLE도 잡는다', () => {
    const violations = findServiceRoleViolations([
      { path: 'src/lib/client.ts', content: 'const k = process.env.NEXT_PUBLIC_SERVICE_ROLE;' },
    ]);

    expect(violations).toEqual([
      { file: 'src/lib/client.ts', line: 1, name: 'NEXT_PUBLIC_SERVICE_ROLE' },
    ]);
  });

  it('서버 전용 SUPABASE_SERVICE_ROLE_KEY는 잡지 않는다', () => {
    const violations = findServiceRoleViolations([
      { path: '.env.local', content: 'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.secret' },
    ]);

    expect(violations).toEqual([]);
  });

  it('NEXT_PUBLIC_SUPABASE_ANON_KEY는 잡지 않는다', () => {
    const violations = findServiceRoleViolations([
      { path: '.env.local', content: 'NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.anon' },
    ]);

    expect(violations).toEqual([]);
  });

  it('여러 파일·여러 줄의 file과 line을 정확히 반환한다', () => {
    const violations = findServiceRoleViolations([
      {
        path: '.env.example',
        content: [
          'NEXT_PUBLIC_SUPABASE_URL=',
          'SUPABASE_SERVICE_ROLE_KEY=',
          'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=',
        ].join('\n'),
      },
      {
        path: 'src/lib/store/supabase-task-store.ts',
        content: ['// ok', '', 'process.env.NEXT_PUBLIC_SERVICE_ROLE_KEY;'].join('\n'),
      },
    ]);

    expect(violations).toEqual([
      { file: '.env.example', line: 3, name: 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY' },
      {
        file: 'src/lib/store/supabase-task-store.ts',
        line: 3,
        name: 'NEXT_PUBLIC_SERVICE_ROLE_KEY',
      },
    ]);
  });

  it('위반이 없으면 빈 배열을 반환한다', () => {
    expect(findServiceRoleViolations([])).toEqual([]);
    expect(
      findServiceRoleViolations([{ path: 'src/app/page.tsx', content: 'export default null;' }])
    ).toEqual([]);
  });

  it('반환된 name에 키 값이 섞이지 않는다', () => {
    const secret = 'eyJhbGciOiJIUzI1NiJ9.SUPER_SECRET_VALUE';
    const violations = findServiceRoleViolations([
      { path: '.env.local', content: `NEXT_PUBLIC_SERVICE_ROLE_KEY=${secret}` },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe('NEXT_PUBLIC_SERVICE_ROLE_KEY');
    expect(violations[0].name).not.toContain('=');
    expect(violations[0].name).not.toContain(secret);
  });
});
