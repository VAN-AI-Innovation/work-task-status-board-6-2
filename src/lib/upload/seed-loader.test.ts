/**
 * 시드 적재의 계약은 **「실제 확정 경로에 그대로 넣을 수 있는 입력인가」** 하나다.
 * 여기서 만든 `CommitPayload`는 `uploads.parse_result`에 담겨 `commitUpload`로 흘러가므로,
 * 모양이 어긋나면 그 사실이 라우트가 아니라 저장소에서 터진다.
 */

import { describe, expect, it } from 'vitest';

import seedJson from '@/lib/fixtures/seed-tasks.json';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { buildSeedPayload } from '@/lib/upload/seed-loader';

const SEED = seedJson as {
  tasks: { id: string; teamId: string }[];
  stages: { taskId: string }[];
  goalMetrics: unknown[];
};

describe('buildSeedPayload — 시드 JSON → 확정 입력', () => {
  it('태스크·목표 지표 건수가 시드와 같다', () => {
    const payload = buildSeedPayload();

    expect(payload.tasks).toHaveLength(SEED.tasks.length);
    expect(payload.goalMetrics).toHaveLength(SEED.goalMetrics.length);
  });

  it('`raw`가 전부 빈 객체다 — 감사용 원본은 실제 업로드만 만든다', () => {
    const payload = buildSeedPayload();

    for (const task of payload.tasks) {
      expect(task.raw).toEqual({});
    }
  });

  it('`stages`가 `taskId`로 묶여 각 태스크에 붙는다', () => {
    const payload = buildSeedPayload();

    const attached = payload.tasks.reduce((total, task) => total + task.stages.length, 0);
    expect(attached).toBe(SEED.stages.length);

    // 단계가 있는 시드 태스크 하나를 골라 개수가 맞는지 본다
    const withStages = SEED.stages[0].taskId;
    const expected = SEED.stages.filter((stage) => stage.taskId === withStages).length;
    const index = SEED.tasks.findIndex((task) => task.id === withStages);
    expect(payload.tasks[index].stages).toHaveLength(expected);
  });

  it('단계에 `id`·`taskId`가 남아 있지 않다 — 저장소가 발급한다', () => {
    const payload = buildSeedPayload();
    const stage = payload.tasks.flatMap((task) => task.stages)[0];

    expect(stage).toBeDefined();
    expect(stage).not.toHaveProperty('id');
    expect(stage).not.toHaveProperty('taskId');
  });

  it('입력 타입에 없는 `id`·`lastProgressAt`이 실려 오지 않고 `sourceUploadId`는 null이다', () => {
    const payload = buildSeedPayload();

    for (const task of payload.tasks) {
      expect(task).not.toHaveProperty('id');
      expect(task).not.toHaveProperty('lastProgressAt');
      expect(task.sourceUploadId).toBeNull();
    }
    for (const metric of payload.goalMetrics) {
      expect(metric).not.toHaveProperty('id');
      expect(metric.sourceUploadId).toBeNull();
    }
  });

  it('`teamId`가 세 팀 안에 들고 `teamKeys`가 실제로 등장한 팀뿐이다', () => {
    const payload = buildSeedPayload();

    for (const task of payload.tasks) {
      expect(TEAM_KEYS).toContain(task.teamId);
    }
    const touched = new Set<string>([
      ...payload.tasks.map((task) => task.teamId),
      ...payload.goalMetrics.map((metric) => metric.teamId),
    ]);
    expect(payload.teamKeys).toEqual(TEAM_KEYS.filter((key) => touched.has(key)));
  });

  it('JSON 왕복을 견딘다 — `uploads.parse_result`에 그대로 들어간다', () => {
    const payload = buildSeedPayload();

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('호출마다 새 객체를 만든다 — 한 번 쓴 payload가 다음 호출에 새지 않는다', () => {
    const first = buildSeedPayload();
    const second = buildSeedPayload();

    expect(first).toEqual(second);
    expect(first.tasks[0]).not.toBe(second.tasks[0]);
  });
});
