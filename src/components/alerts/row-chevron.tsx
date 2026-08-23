/**
 * 목록 한 줄이 **누르면 열리는 줄**임을 정지 상태에서도 말하는 표시.
 *
 * 밑줄만으로는 부족했다 — hover하기 전에는 링크인지 그냥 글자인지 알 수 없어서, 이 패널의
 * 항목이 눌린다는 사실을 아무도 발견하지 못했다. 화살표는 마우스를 올리기 **전에** 보인다.
 *
 * `UI_GUIDE.md`「아이콘」 그대로다: 인라인 SVG · 16px · `strokeWidth 1.5` · 둥근 배경 컨테이너
 * 없이. 색은 쓰는 쪽이 정한다 (`currentColor`).
 */

export function RowChevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
