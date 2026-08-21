/**
 * `extras` 안의 민감 값을 역할에 따라 가린다 (`S6`).
 *
 * 시트에는 **출연자 연락처(내부용)와 문의자 SNS 계정**이 실제로 들어 있고, 설계상 그 값들은
 * `extras`에 원문 그대로 보존된다. 보존은 맞다 — 감사·복원이 그것으로 이뤄진다. 그래서 거르는
 * 곳은 **응답 계층 한 곳**이며, 저장소·파서는 마스킹을 모른다. 두 곳에서 거르면 한쪽만
 * 고쳐졌을 때 어느 쪽이 진짜인지 알 수 없고, 저장소에서 거르면 원본이 사라진다.
 *
 * `PLAN.md` `S6`가 이 목록을 `lib/domain/`에 두라고 못박았다 — 판정이므로 도메인이다.
 */

import type { ExtraValue } from '@/types/task';

/** 인증은 T8이다. 그때까지 이 값은 `?as=`에서 온다 (`lib/api/viewer-role.ts`) */
export type ViewerRole = 'admin' | 'lead' | 'member';

/**
 * **부분 일치로 본다.** 시트 헤더는 `출연자 연락처`·`문의자 계정`처럼 접두어를 달고 오고,
 * `계정번호`처럼 접미어가 붙기도 한다. 정확 일치로 두면 실제 시트의 키를 하나도 못 잡는다.
 *
 * 영문 항목(`email`·`phone`·`contact`)을 넣은 근거: 배정표 xlsx를 재업로드하는 고리(UC-06)와
 * 손으로 만든 탭에서 영문 헤더가 섞여 들어온다. 한글 목록만 두면 `Contact`가 그대로 통과한다.
 */
export const SENSITIVE_EXTRA_KEYS: readonly string[] = [
  '연락처',
  '계정',
  '이메일',
  '전화',
  'email',
  'phone',
  'contact',
];

/** 비교는 소문자화 + `includes`. 앞뒤 공백은 부분 일치에 영향이 없어 따로 다듬지 않는다 */
export function isSensitiveExtraKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_EXTRA_KEYS.some((sensitive) => normalized.includes(sensitive));
}

/**
 * `member`에게는 민감 키의 **값만** 지운다. **키는 남긴다** — 사이드 패널에서
 * "연락처: (비공개)"로 보이는 편이 필드가 사라지는 것보다 낫다. 무엇이 가려졌는지 알 수 있고,
 * 값이 원래 비어 있었던 것과 가려진 것이 구분된다.
 *
 * 입력 객체는 고치지 않는다 — 같은 태스크를 두 역할에게 내려보내는 경로가 생기면
 * 먼저 지나간 마스킹이 뒤엣것의 원본을 지운다.
 */
export function maskExtras(
  extras: Record<string, ExtraValue>,
  role: ViewerRole
): Record<string, ExtraValue> {
  if (role !== 'member') return { ...extras };

  const masked: Record<string, ExtraValue> = {};
  for (const [key, value] of Object.entries(extras)) {
    masked[key] = isSensitiveExtraKey(key) ? null : value;
  }
  return masked;
}
