/**
 * Chart.js는 tree-shaking을 위해 **쓸 요소를 직접 등록**해야 한다. 그 등록을 이 파일
 * **한 곳에서만** 한다 — 두 차트가 각자 등록하면 어느 쪽 모듈이 먼저 로드됐는지에 따라
 * 동작이 갈리고, 그 차이는 개발 서버에서는 안 보이다가 프로덕션 번들에서 드러난다.
 *
 * 부작용 import(`import '...'`) 대신 함수를 내보낸다. 부작용 import는 번들러·린터가
 * 「안 쓰는 import」로 보고 지우기 쉽다. `register`는 멱등이라 여러 번 불러도 된다.
 */

import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';

/**
 * 가로 바(`BarElement` + 두 축)만 등록한다. **`ArcElement`는 없다** — 도넛을 버렸고
 * (`ADR-019`) 상태 분포는 Chart.js를 거치지 않는 `div` 스택 바다.
 */
export function registerCharts(): void {
  ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);
}
