/**
 * 이 파일이 지키는 것은 하나다 — **역할 라벨이 한 벌이다.** 상단 바와 역할 전환 버튼이
 * 같은 표를 보는지, 그리고 세 역할이 하나도 빠지지 않았는지를 잰다.
 */

import { describe, expect, it } from 'vitest';

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { ROLE_LABELS, roleLabel } from '@/lib/view/role-label';

const ROLES: readonly ViewerRole[] = ['admin', 'lead', 'member'];

describe('ROLE_LABELS', () => {
  it('세 역할이 넓은 것부터 좁은 것 순으로 한 번씩 있다', () => {
    expect(ROLE_LABELS.map((item) => item.key)).toEqual(ROLES);
  });

  it('라벨이 서로 다르고 빈 문자열이 없다', () => {
    const labels = ROLE_LABELS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.trim() !== '')).toBe(true);
  });
});

describe('roleLabel', () => {
  it('세 역할을 한글로 옮긴다', () => {
    expect(roleLabel('admin')).toBe('대표·실장');
    expect(roleLabel('lead')).toBe('팀장');
    expect(roleLabel('member')).toBe('부원');
  });

  it('표와 같은 값을 돌려준다 — 두 벌이 아니다', () => {
    for (const { key, label } of ROLE_LABELS) expect(roleLabel(key)).toBe(label);
  });

  /* 타입이 캐스팅으로 뚫렸을 때 화면이 빈 글자가 되지 않는다 */
  it('알 수 없는 값이 들어와도 빈 글자를 내지 않는다', () => {
    expect(roleLabel('owner' as ViewerRole)).toBe('owner');
  });
});
