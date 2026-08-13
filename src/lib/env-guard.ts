/**
 * `service_role` 키에 `NEXT_PUBLIC_` 접두사가 붙으면 브라우저에 그대로 노출된다 (PLAN.md S5).
 * 이 모듈은 탐지만 한다 — 파일 I/O는 호출자가 하고, 인자로 받은 내용만 보고 판단한다.
 */

export interface EnvGuardViolation {
  /** 위반이 발견된 파일 경로 (저장소 루트 기준 상대 경로) */
  file: string;
  /** 1부터 시작하는 줄 번호 */
  line: number;
  /** 탐지된 환경변수 이름. 값은 절대 담지 않는다 */
  name: string;
}

/** `NEXT_PUBLIC_`로 시작하면서 `SERVICE_ROLE`을 포함하는 식별자 */
const SERVICE_ROLE_PATTERN = /\bNEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*/g;

export function findServiceRoleViolations(
  files: { path: string; content: string }[]
): EnvGuardViolation[] {
  const violations: EnvGuardViolation[] = [];

  for (const file of files) {
    file.content.split('\n').forEach((lineText, index) => {
      for (const match of lineText.matchAll(SERVICE_ROLE_PATTERN)) {
        // 이름만 담는다. 줄 전체를 담으면 가드가 키를 로그에 유출하는 도구가 된다.
        violations.push({ file: file.path, line: index + 1, name: match[0] });
      }
    });
  }

  return violations;
}
