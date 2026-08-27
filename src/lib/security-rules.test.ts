/**
 * T11 step 9(보안 감사)의 정적 검사. `env-guard.test.ts`와 **같은 모양이되 같은 파일이
 * 아니다** — 저쪽은 `prebuild`가 부르는 별개의 게이트이고 지키는 규칙도 하나뿐이다
 * (`NEXT_PUBLIC_` + `service_role`). 둘을 합치면 실패했을 때 무엇이 깨졌는지가 메시지에서
 * 흐려진다.
 *
 * 앞부분은 `findAuthRouteViolations` 자체를 재고, 뒷부분은 **이 저장소를 실제로 스캔**해
 * 위반이 0건임을 단언한다. 규칙을 사람의 주의력에 맡기지 않는 것이 이 파일의 존재 이유다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findAuthRouteViolations, type SecurityViolation } from '@/lib/security-rules';

function ruleIds(violations: SecurityViolation[]): string[] {
  return violations.map((violation) => violation.rule);
}

describe('규칙 1 — 인증·팀·멤버 라우트에 service_role이 닿지 않는다 (ADR-024)', () => {
  it('service_role 키를 읽으면 잡는다', () => {
    const found = findAuthRouteViolations([
      {
        path: 'src/app/api/team/requests/approve/route.ts',
        content: 'const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\nisSameOrigin(r);\n',
      },
    ]);

    expect(ruleIds(found)).toEqual(['service-role-in-auth-route']);
    expect(found[0].line).toBe(1);
  });

  it('전역 싱글턴 getStorage()를 부르면 잡는다 — 그것이 service_role 경로다', () => {
    const found = findAuthRouteViolations([
      {
        path: 'src/app/api/members/role/route.ts',
        content: '// ok\nconst s = await getStorage();\nisSameOrigin(r);\n',
      },
    ]);

    expect(ruleIds(found)).toEqual(['service-role-in-auth-route']);
    expect(found[0].line).toBe(2);
  });

  it('범위 밖 라우트의 getStorage()는 잡지 않는다 — 업로드 확정은 service_role이 맞다', () => {
    expect(
      findAuthRouteViolations([
        { path: 'src/app/api/uploads/seed/route.ts', content: 'await getStorage();' },
      ])
    ).toEqual([]);
  });
});

describe('규칙 2 — 상태를 바꾸는 POST에 출처 검사가 있다 (CSRF)', () => {
  it('POST를 내보내면서 isSameOrigin을 부르지 않으면 잡는다', () => {
    const found = findAuthRouteViolations([
      {
        path: 'src/app/api/auth/login/route.ts',
        content: 'export async function POST(request: Request) { return new Response(); }',
      },
    ]);

    expect(ruleIds(found)).toEqual(['post-without-origin-check']);
  });

  it('requestIsSameOrigin으로 불러도 통과한다 — 헤더를 꺼내는 자리는 한 곳이다', () => {
    expect(
      findAuthRouteViolations([
        {
          path: 'src/app/api/auth/logout/route.ts',
          content:
            "import { requestIsSameOrigin } from '@/lib/api/same-origin';\n" +
            'export async function POST(r: Request) { requestIsSameOrigin(r); }',
        },
      ])
    ).toEqual([]);
  });

  it('POST가 없는 라우트는 잡지 않는다', () => {
    expect(
      findAuthRouteViolations([
        {
          path: 'src/app/api/team/requests/route.ts',
          content: 'export async function GET() { return new Response(); }',
        },
      ])
    ).toEqual([]);
  });

  it('route.ts가 아닌 파일은 잡지 않는다 — 스키마 파일에 POST라는 낱말이 있어도 된다', () => {
    expect(
      findAuthRouteViolations([
        { path: 'src/app/api/auth/login/helper.ts', content: 'export function POST() {}' },
      ])
    ).toEqual([]);
  });
});

describe('규칙 3 — 인증 라우트는 아무것도 로그에 남기지 않는다 (S6)', () => {
  it.each(['console.log(x)', 'console.error(x)', 'console.warn(x)'])('%s를 잡는다', (call) => {
    const found = findAuthRouteViolations([
      {
        path: 'src/app/api/auth/signup/route.ts',
        content: `isSameOrigin(r);\nexport async function POST() { ${call}; }`,
      },
    ]);

    expect(ruleIds(found)).toEqual(['console-in-auth-route']);
    expect(found[0].line).toBe(2);
  });

  it('인증 라우트 밖의 console은 이 규칙이 보지 않는다', () => {
    expect(
      findAuthRouteViolations([
        { path: 'src/app/api/health/route.ts', content: 'console.log("up");' },
      ])
    ).toEqual([]);
  });
});

describe('규칙 4 — 권한을 user_metadata에서 읽지 않는다 (권한 상승 경로)', () => {
  it.each(["role", "status"])("raw_user_meta_data->>'%s'를 잡는다", (key) => {
    const found = findAuthRouteViolations([
      {
        path: 'supabase/migrations/0005_signup_approval.sql',
        content: `insert into public.profiles (role) values (new.raw_user_meta_data->>'${key}');`,
      },
    ]);

    expect(ruleIds(found)).toEqual(['metadata-privilege-read']);
  });

  it("team_id·display_name은 잡지 않는다 — 그 둘은 트리거가 검증해 쓴다", () => {
    expect(
      findAuthRouteViolations([
        {
          path: 'supabase/migrations/0005_signup_approval.sql',
          content:
            "new.raw_user_meta_data->>'team_id'\nnew.raw_user_meta_data->>'display_name'",
        },
      ])
    ).toEqual([]);
  });

  it('role·status를 언급하는 주석은 잡지 않는다 — 근거를 적을 수 있어야 한다', () => {
    expect(
      findAuthRouteViolations([
        {
          path: 'supabase/migrations/0005_signup_approval.sql',
          content: '-- role과 status를 raw_user_meta_data에서 읽지 않는다.',
        },
      ])
    ).toEqual([]);
  });
});

describe('규칙 5 — 세션 해석은 getUser()로 한다', () => {
  it('viewer-session.ts의 getSession을 잡는다 — 쿠키를 검증 없이 믿는 자리다', () => {
    const found = findAuthRouteViolations([
      { path: 'src/lib/auth/viewer-session.ts', content: 'const s = await auth.getSession();' },
    ]);

    expect(ruleIds(found)).toEqual(['get-session-in-viewer-session']);
  });

  it('getUser는 잡지 않는다', () => {
    expect(
      findAuthRouteViolations([
        { path: 'src/lib/auth/viewer-session.ts', content: 'await auth.getUser();' },
      ])
    ).toEqual([]);
  });
});

describe('규칙 6 — 유출 대조에 나가는 것은 해시 접두사 5글자뿐이다 (k-익명성)', () => {
  it('range/ 뒤에 해시를 그대로 붙이면 잡는다', () => {
    const found = findAuthRouteViolations([
      {
        path: 'src/lib/auth/pwned-password.ts',
        content: "await fetch('https://api.pwnedpasswords.com/range/ABCDEF0123');",
      },
    ]);

    expect(ruleIds(found)).toEqual(['pwned-prefix-too-long']);
  });

  it('slice(0, 6)처럼 접두사를 늘리면 잡는다 — k가 줄어든다', () => {
    const found = findAuthRouteViolations([
      { path: 'src/lib/auth/pwned-password.ts', content: 'const prefix = digest.slice(0, 6);' },
    ]);

    expect(ruleIds(found)).toEqual(['pwned-prefix-too-long']);
  });

  it('상수를 거쳐 늘려도 잡는다 — 이름을 바꿔 숨길 수 없다', () => {
    const found = findAuthRouteViolations([
      {
        path: 'src/lib/auth/pwned-password.ts',
        content: 'const PREFIX_LENGTH = 8;\nconst prefix = digest.slice(0, PREFIX_LENGTH);',
      },
    ]);

    expect(ruleIds(found)).toEqual(['pwned-prefix-too-long']);
    expect(found[0].line).toBe(2);
  });

  it('5글자면 통과한다', () => {
    expect(
      findAuthRouteViolations([
        {
          path: 'src/lib/auth/pwned-password.ts',
          content:
            "const RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/';\n" +
            'const PREFIX_LENGTH = 5;\n' +
            'const prefix = digest.slice(0, PREFIX_LENGTH);\n' +
            'await deps.fetch(`${RANGE_ENDPOINT}${prefix}`);',
        },
      ])
    ).toEqual([]);
  });

  it('다른 파일의 slice(0, 40)은 보지 않는다', () => {
    expect(
      findAuthRouteViolations([
        { path: 'src/lib/domain/kst-today.ts', content: 'value.slice(0, 10);' },
      ])
    ).toEqual([]);
  });
});

describe('findAuthRouteViolations — 공통', () => {
  it('테스트 파일은 스캔하지 않는다 — 픽스처가 금지 문자열을 들고 있다', () => {
    expect(
      findAuthRouteViolations([
        {
          path: 'src/app/api/auth/login/route.test.ts',
          content: 'console.log(process.env.SUPABASE_SERVICE_ROLE_KEY);',
        },
      ])
    ).toEqual([]);
  });

  it('빈 입력과 무관한 파일에는 아무것도 내지 않는다', () => {
    expect(findAuthRouteViolations([])).toEqual([]);
    expect(
      findAuthRouteViolations([{ path: 'src/app/page.tsx', content: 'export default null;' }])
    ).toEqual([]);
  });

  it('값이 아니라 위치와 규칙만 담는다 — 가드가 비밀을 로그로 흘리면 안 된다', () => {
    const secret = 'sb_secret_THIS_MUST_NOT_LEAK';
    const found = findAuthRouteViolations([
      {
        path: 'src/app/api/auth/login/route.ts',
        content: `isSameOrigin(r);\nconst k = '${secret}'; // SUPABASE_SERVICE_ROLE_KEY`,
      },
    ]);

    expect(found).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain(secret);
  });
});

/* ------------------------------------------------------------------------- */
/* 저장소 스캔 — 규칙이 지금 코드에서 실제로 지켜지는가                          */
/* ------------------------------------------------------------------------- */

const REPO_ROOT = process.cwd();

/**
 * 규칙이 걸리는 자리만 읽는다. `env-guard.test.ts`처럼 저장소 전체를 훑지 않는 것은 이
 * 검사가 **경로로 규칙을 고르기** 때문이다 — 대상이 아닌 디렉토리를 읽어 봐야 결과가 같다.
 */
const SCAN_ROOTS = ['src/app/api', 'src/lib/auth', 'src/lib/api', 'supabase/migrations'];

function walk(absolute: string, relative: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const next = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(path.join(absolute, entry.name), next));
    else if (entry.isFile()) found.push(next);
  }

  return found;
}

function scanTargets(): { path: string; content: string }[] {
  const targets: { path: string; content: string }[] = [];

  for (const root of SCAN_ROOTS) {
    const absolute = path.join(REPO_ROOT, root);
    if (!statSync(absolute, { throwIfNoEntry: false })?.isDirectory()) continue;

    for (const file of walk(absolute, root)) {
      targets.push({ path: file, content: readFileSync(path.join(REPO_ROOT, file), 'utf8') });
    }
  }

  return targets;
}

describe('저장소 스캔', () => {
  it('규칙 여섯이 현재 코드에서 위반 0건이다', () => {
    const targets = scanTargets();
    // 목록이 비면 검사가 통과한 것이 아니라 아무것도 안 본 것이다
    expect(targets.length).toBeGreaterThan(0);

    const report = findAuthRouteViolations(targets)
      .map((violation) => `${violation.file}:${violation.line} ${violation.rule} ${violation.detail}`)
      .join('\n');

    expect(report).toBe('');
  });

  it('출처 검사가 걸린 POST 라우트가 일곱이다 — 규칙이 대상을 실제로 보고 있다', () => {
    const posts = scanTargets().filter(
      (file) =>
        file.path.endsWith('/route.ts') &&
        /export\s+(async\s+)?function\s+POST\b/.test(file.content) &&
        ['src/app/api/auth/', 'src/app/api/team/', 'src/app/api/members/'].some((dir) =>
          file.path.startsWith(dir)
        )
    );

    expect(posts.map((file) => file.path).sort()).toEqual([
      'src/app/api/auth/login/route.ts',
      'src/app/api/auth/logout/route.ts',
      'src/app/api/auth/rejoin/route.ts',
      'src/app/api/auth/signup/route.ts',
      'src/app/api/members/role/route.ts',
      'src/app/api/team/requests/approve/route.ts',
      'src/app/api/team/requests/reject/route.ts',
    ]);
  });
});

/* ------------------------------------------------------------------------- */
/* SQL이 지는 상태 전이 규칙 — 앱에서 재현할 수 없는 방어                        */
/* ------------------------------------------------------------------------- */

/**
 * 공격 #6·#9·#10의 마지막 한 겹은 **함수 안에** 있다. 원격 DB에는 실업무 데이터가 있어
 * 실계정으로 시험하지 않으므로(step 9 금지사항), 여기서는 **적용된 정의 자체**를 읽어
 * 단언한다. 문장이 지워지면 이 테스트가 먼저 빨개진다.
 */
const MIGRATION = readFileSync(
  path.join(REPO_ROOT, 'supabase/migrations/0005_signup_approval.sql'),
  'utf8'
);

function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = MIGRATION.indexOf('as $$', start);
  const close = MIGRATION.indexOf('end $$;', open);
  expect(close).toBeGreaterThan(open);

  return MIGRATION.slice(open, close);
}

describe('공격 #10 — 거절된 계정이 request_join으로 스스로 active가 되는가', () => {
  const body = functionBody('request_join');

  it("status를 'pending'으로만 세운다 — 'active'라는 문자열이 없다", () => {
    expect(body).toContain("set team_id = team, status = 'pending'");
    expect(body).not.toContain("'active'");
  });

  it("거절된 행에서만 움직인다 — where에 status = 'rejected'가 있다", () => {
    expect(body).toContain("status = 'rejected'");
  });

  it('대상은 auth.uid()다 — 인자로 남을 지목할 수 없다', () => {
    expect(body).toContain('id = (select auth.uid())');
    expect(MIGRATION).toContain('function public.request_join(team text)');
  });
});

describe('공격 #6 — set_role로 자기를 admin으로 올리는가', () => {
  const body = functionBody('set_role');

  it("admin이 아니면 예외다", () => {
    expect(body).toContain("if public.my_role() <> 'admin' then");
  });

  it("배정 가능한 역할이 lead·member 둘뿐이다", () => {
    expect(body).toContain("if new_role not in ('lead','member') then");
  });
});

describe('공격 #9 — 남에게 붙은 members 행을 빼앗는가', () => {
  const body = functionBody('approve_join');

  it('이미 다른 계정에 붙은 행이면 예외다', () => {
    expect(body).toContain('if linked is not null and linked <> target then');
  });

  it('같은 팀이 아니면 예외다', () => {
    expect(body).toContain('member not in target team');
  });

  it('승인은 승격이 아니다 — 역할을 건드리지 않는다', () => {
    expect(body).not.toContain('set role =');
  });
});

/**
 * 공격 #5·#7 — **`lead`가 남의 팀 요청을 승인**하거나 **`member`가 승인·거절 라우트를 직접
 * 두드린다.** 앱은 이 둘을 역할로 거르지 않는다(step 5·6이 정한 「앱이 범위를 다시 거르지
 * 않는다」) — 문은 `can_review_join` 하나이고, 그것이 무너지면 라우트가 아무리 촘촘해도
 * 소용이 없다. 그래서 **그 함수의 정의 자체**를 읽어 못박는다.
 */
describe('공격 #5·#7 — 남의 팀 요청을 승인하거나 member가 직접 부르는가', () => {
  const body = functionBody('can_review_join');

  it('admin이거나 lead여야 한다 — member는 어느 갈래에도 없다', () => {
    expect(body).toContain("public.my_role() = 'admin'");
    expect(body).toContain("public.my_role() = 'lead'");
    expect(body).not.toContain("'member'");
  });

  /** 팀이 `null`인 `lead`가 전원을 통과시키면 안 된다 — SQL의 `=`가 `null`에 참을 내지 않는 성질에만 기대지 않는다 */
  it('lead 갈래는 팀이 있고 그 팀이 대상과 같을 때만 참이다 (공격 #5)', () => {
    expect(body).toContain('public.my_team() is not null');
    expect(body).toContain('p.id = target and p.team_id = public.my_team()');
  });

  /** 승인·거절 둘 다 같은 문을 지난다. 하나만 지키면 다른 하나가 문이 된다 */
  it.each(['approve_join', 'reject_join'])('%s이 can_review_join으로 먼저 막는다', (name) => {
    expect(functionBody(name)).toContain('if not public.can_review_join(target) then');
  });

  /**
   * `pending_requests`는 자격 미달에 **예외가 아니라 0행**을 낸다(그래서 라우트가 503이
   * 아니라 빈 목록을 받는다). 범위를 정하는 것이 여기 있으므로 그 조건도 함께 못박는다.
   */
  it('pending_requests가 admin 전체 / lead 자기 팀으로 범위를 가른다 (열거 방어)', () => {
    const body = functionBody('pending_requests');

    expect(body).toContain("public.my_role() = 'admin'");
    expect(body).toContain("public.my_role() = 'lead'");
    expect(body).not.toContain("'member'");
  });
});
