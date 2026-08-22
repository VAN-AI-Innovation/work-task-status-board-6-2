'use client';

/**
 * 상단 바 검색. `?search=`에 묶인다.
 *
 * **입력마다 라우팅하지 않는다.** 타이핑 한 글자에 서버 컴포넌트를 다시 그리면 응답이
 * 돌아오는 사이 입력이 밀려 글자를 놓친다. 이동은 **form submit(Enter)에서만** 한다.
 *
 * 값을 `useState`로 들고 있지 않은 이유: 뒤로가기·역할 전환처럼 URL이 밖에서 바뀌었을 때
 * 입력 상자만 옛 값으로 남는다. `key`를 현재 `?search=`로 두어 **URL이 바뀌면 입력이
 * 다시 태어나게** 한다 — 화면 상태의 단일 소스는 URL이다 (`dashboard-query.ts`).
 */

import { useRouter } from 'next/navigation';

import { buildHref, type DashboardQuery } from '@/lib/view/dashboard-query';

export function SearchBox({ pathname, query }: { pathname: string; query: DashboardQuery }) {
  const router = useRouter();

  return (
    <form
      role="search"
      className="min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = new FormData(event.currentTarget).get('search');
        const trimmed = typeof raw === 'string' ? raw.trim() : '';
        // 빈 값은 `null`이라 링크에서 키 자체가 사라진다 (`buildHref`)
        router.push(buildHref(pathname, query, { search: trimmed === '' ? null : trimmed }));
      }}
    >
      <label className="sr-only" htmlFor="shell-search">
        업무 검색
      </label>
      <input
        key={query.search ?? ''}
        id="shell-search"
        name="search"
        type="search"
        defaultValue={query.search ?? ''}
        placeholder="업무명·담당자 검색 후 Enter"
        className="border-line bg-canvas text-ink placeholder:text-ink-faint focus:border-ink w-full max-w-[420px] rounded border px-3 py-1.5 text-sm focus:outline-none"
      />
    </form>
  );
}
