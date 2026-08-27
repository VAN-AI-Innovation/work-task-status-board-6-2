import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

const REPO_ROOT = process.cwd();

/** 빌드 산출물과 하네스 지시 파일은 스캔하지 않는다 */
const EXCLUDED_DIRS = ['node_modules/', '.next/', 'phases/'];

/**
 * 가드 자신은 제외한다. 탐지 패턴 문자열과 테스트 픽스처가 들어 있어서,
 * 제외하지 않으면 가드가 스스로를 위반으로 신고하고 영구 실패한다.
 */
const EXCLUDED_FILES = ['src/lib/env-guard.ts', 'src/lib/env-guard.test.ts'];

/** git이 없어 직접 걸을 때만 쓴다. 걸어 들어가 봐야 소용없는 디렉토리들 */
const SKIPPED_WALK_DIRS = ['node_modules', '.next', 'phases', '.git', '.vercel'];

/**
 * 배포 빌드에는 `.git`이 없다 (Vercel은 소스만 업로드한다). `git ls-files`가 거기서
 * 던지면 `prebuild`가 통째로 실패해 **가드가 지키려던 빌드 자체가 막힌다.**
 * 그래서 git이 없으면 파일 시스템을 직접 걷는다 — 목록을 얻는 수단만 다르고
 * 스캔 범위는 같다. **조용히 건너뛰지 않는다**: 여기서 빈 목록을 돌려주면
 * 아래 `toBeGreaterThan(0)`이 잡는다.
 */
function walkFiles(dir: string, prefix = ''): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (SKIPPED_WALK_DIRS.includes(entry.name)) continue;

    if (entry.isDirectory()) found.push(...walkFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
  }

  return found;
}

function listTrackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return walkFiles(REPO_ROOT);
  }
}

function listScanTargets(): string[] {
  const tracked = listTrackedFiles();

  // .gitignore가 .env*를 무시하지만 실제 유출 경로는 바로 거기다.
  const envFiles = readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
    .map((entry) => entry.name);

  return [...new Set([...tracked, ...envFiles])].filter(
    (file) => !EXCLUDED_DIRS.some((dir) => file.startsWith(dir)) && !EXCLUDED_FILES.includes(file)
  );
}

function readScanTargets(files: string[]): { path: string; content: string }[] {
  const targets: { path: string; content: string }[] = [];

  for (const file of files) {
    const absolute = path.join(REPO_ROOT, file);
    if (!existsSync(absolute)) continue;

    try {
      targets.push({ path: file, content: readFileSync(absolute, 'utf8') });
    } catch {
      // 읽을 수 없는 파일은 건너뛴다. 스캔을 실패시키지 않는다.
    }
  }

  return targets;
}

describe('저장소 스캔', () => {
  it('추적 파일과 루트 .env* 어디에도 NEXT_PUBLIC_ service_role 키가 없다', () => {
    const targets = readScanTargets(listScanTargets());
    expect(targets.length).toBeGreaterThan(0);

    // 위치와 이름만 남긴다. 위반한 줄을 통째로 출력하면 CI 로그로 키가 유출된다.
    const report = findServiceRoleViolations(targets)
      .map((violation) => `${violation.file}:${violation.line} ${violation.name}`)
      .join('\n');

    expect(report).toBe('');
  });
});
