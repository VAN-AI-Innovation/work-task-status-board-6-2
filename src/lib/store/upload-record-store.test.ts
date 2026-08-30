/**
 * `UploadRecordStore` 두 구현이 **함께 통과해야 하는** 계약 (`ADR-008`).
 *
 * 계약 함수를 이 파일에서 한 번만 정의하고 memory·supabase가 각자 부른다. 구현별로
 * 복사하면 두 벌이 조금씩 갈라지고, 갈라진 계약은 계약이 아니다
 * (`repository-contract.ts`가 같은 이유로 존재한다).
 *
 * 이 스위트가 지키는 것 둘.
 *
 * 1. **확정하면 `parseResult`가 `null`이 된다** — 성능이 아니라 개인정보 조치다 (`S6`).
 *    원본 행에 실명·연락처·문의자 계정이 들어 있다.
 * 2. **두 번째 확정은 `null`이다** — 사용자는 버튼을 두 번 누른다.
 */

import { describe, expect, it } from 'vitest';

import {
  createMemoryUploadStore,
  createSupabaseUploadStore,
  type UploadRecordStore,
  type UploadSummary,
} from '@/lib/store/upload-record-store';
import { createServiceRoleClient } from '@/lib/store/supabase-task-store';
import type { CommitPayload } from '@/lib/upload/upload-preview';
import type { TaskUpsertInput } from '@/lib/store/task-repository';

/**
 * supabase 갈래의 격리 근거. `filename`이 이 접두사로 시작하는 행만 `reset`이 지운다 —
 * 필터 없는 `delete()`는 실업무 업로드 이력을 통째로 날린다.
 */
const UPLOAD_CONTRACT_PREFIX = 'contract::';

/** 저장소는 시계를 읽지 않는다. 이 값이 그대로 돌아와야 한다 */
const CREATED_AT = '2026-08-21T09:00:00.000Z';

const TASK: TaskUpsertInput = {
  teamId: 'edit',
  departmentId: null,
  sourceKey: 'contract::upload-probe',
  title: '카드뉴스 A',
  ownerMemberId: null,
  ownerNameRaw: '김편집',
  coOwnerNames: [],
  status: '진행 중',
  approvalStatus: null,
  priority: null,
  riskStatus: null,
  progress: null,
  assignedAt: null,
  dueAt: '2026-08-30',
  nextAction: null,
  nextActionOwner: null,
  nextActionDue: null,
  delayReason: null,
  note: null,
  extras: { 채널: '인스타' },
  raw: { 업무명: '카드뉴스 A' },
  sourceUploadId: null,
  sourceSheetTab: '01_편집팀',
  sourceRowIndex: 10,
  stages: [],
};

const PAYLOAD: CommitPayload = {
  tasks: [TASK],
  goalMetrics: [],
  teamKeys: ['edit'],
  enums: [],
};

const SUMMARY: UploadSummary = {
  created: 1,
  updated: 0,
  unchanged: 0,
  goalMetricsCreated: 0,
  goalMetricsUpdated: 0,
  warningCount: 2,
  teamKeys: ['edit'],
};

export interface UploadStoreFixture {
  create(): Promise<UploadRecordStore>;
  /** 각 케이스 전에 계약이 만든 행만 지운다 */
  reset(store: UploadRecordStore): Promise<void>;
}

function newUpload(suffix: string) {
  return {
    kind: 'sheet' as const,
    filename: `${UPLOAD_CONTRACT_PREFIX}${suffix}.xlsx`,
    parseResult: PAYLOAD,
    createdAt: CREATED_AT,
  };
}

export function describeUploadStoreContract(label: string, fixture: UploadStoreFixture): void {
  describe(`UploadRecordStore 계약 — ${label}`, () => {
    async function freshStore(): Promise<UploadRecordStore> {
      const store = await fixture.create();
      await fixture.reset(store);
      return store;
    }

    it('1. create → get이 같은 레코드를 준다 (previewing · parseResult 살아 있음)', async () => {
      const store = await freshStore();

      const created = await store.create(newUpload('c1'));
      expect(created.status).toBe('previewing');
      expect(created.kind).toBe('sheet');
      expect(created.parseResult).toEqual(PAYLOAD);
      expect(created.summary).toBeNull();

      const fetched = await store.get(created.id);
      expect(fetched).toEqual(created);
    });

    it('2. 없는 id는 null이다', async () => {
      const store = await freshStore();

      // uuid 모양이지만 존재하지 않는 값. 형식이 깨진 문자열도 던지지 않고 null이다.
      expect(await store.get('99999999-9999-4999-8999-999999999999')).toBeNull();
      expect(await store.get('그런-id-없음')).toBeNull();
    });

    it('3. markCommitted 후 done · parseResult가 null · summary가 들어 있다', async () => {
      const store = await freshStore();
      const created = await store.create(newUpload('c3'));

      const committed = await store.markCommitted(created.id, SUMMARY);

      expect(committed?.status).toBe('done');
      // 개인정보 조치다 (S6·T5 완료 기준 13). 지우는 것을 잊으면 원본 행이 남는다.
      expect(committed?.parseResult).toBeNull();
      expect(committed?.summary).toEqual(SUMMARY);

      const fetched = await store.get(created.id);
      expect(fetched?.parseResult).toBeNull();
      expect(fetched?.summary).toEqual(SUMMARY);
    });

    it('4. markCommitted를 두 번 부르면 두 번째는 null이다 (중복 확정 방어)', async () => {
      const store = await freshStore();
      const created = await store.create(newUpload('c4'));

      expect(await store.markCommitted(created.id, SUMMARY)).not.toBeNull();
      expect(await store.markCommitted(created.id, SUMMARY)).toBeNull();

      // 두 번째 호출이 첫 결과를 덮어쓰지 않았다.
      const fetched = await store.get(created.id);
      expect(fetched?.status).toBe('done');
      expect(fetched?.summary).toEqual(SUMMARY);
    });

    it('5. markFailed 후 failed이고 parseResult가 그대로 살아 있다', async () => {
      const store = await freshStore();
      const created = await store.create(newUpload('c5'));

      const failed = await store.markFailed(created.id);

      expect(failed?.status).toBe('failed');
      // 재시도가 같은 입력으로 돌아야 한다. 여기서 지우면 사용자가 파일을 다시 올려야 한다.
      expect(failed?.parseResult).toEqual(PAYLOAD);

      const fetched = await store.get(created.id);
      expect(fetched?.parseResult).toEqual(PAYLOAD);
    });

    it('6. markFailed 후 markCommitted는 성공하지 않는다 (previewing이 아니다)', async () => {
      const store = await freshStore();
      const created = await store.create(newUpload('c6'));

      await store.markFailed(created.id);

      expect(await store.markCommitted(created.id, SUMMARY)).toBeNull();
      expect((await store.get(created.id))?.status).toBe('failed');
    });

    it('7. 돌려준 레코드를 호출자가 고쳐도 저장소 내부가 바뀌지 않는다', async () => {
      const store = await freshStore();
      const created = await store.create(newUpload('c7'));

      created.status = 'done';
      created.parseResult!.tasks[0].title = '오염된 제목';
      created.parseResult!.teamKeys.push('shoot');

      const fetched = await store.get(created.id);
      expect(fetched?.status).toBe('previewing');
      expect(fetched?.parseResult).toEqual(PAYLOAD);
    });

    it('8. createdAt이 인자로 준 값 그대로다 (저장소가 시계를 읽지 않는다)', async () => {
      const store = await freshStore();

      const created = await store.create(newUpload('c8'));

      expect(created.createdAt).toBe(CREATED_AT);
      expect((await store.get(created.id))?.createdAt).toBe(CREATED_AT);
    });

    it('9. 서로 다른 업로드는 서로의 확정에 영향받지 않는다', async () => {
      const store = await freshStore();
      const first = await store.create(newUpload('c9-a'));
      const second = await store.create(newUpload('c9-b'));

      expect(first.id).not.toBe(second.id);
      await store.markCommitted(first.id, SUMMARY);

      const other = await store.get(second.id);
      expect(other?.status).toBe('previewing');
      expect(other?.parseResult).toEqual(PAYLOAD);
    });
  });
}

describeUploadStoreContract('memory', {
  async create() {
    return createMemoryUploadStore();
  },
  async reset(store) {
    (store as ReturnType<typeof createMemoryUploadStore>).clear();
  },
});

/**
 * 자격증명이 없으면 계약이 조용히 0건 통과한 것처럼 보이면 안 되므로 흔적을 남긴다
 * (`supabase-task-store.test.ts`와 같은 방식).
 */
const canRun = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

if (canRun) {
  const client = createServiceRoleClient();
  if (!client) throw new Error('자격증명이 있는데 클라이언트가 만들어지지 않았다');

  describeUploadStoreContract('supabase', {
    async create() {
      return createSupabaseUploadStore(client);
    },
    async reset() {
      // **접두사가 붙은 행만** 지운다. 필터 없는 delete는 실업무 업로드 이력을 통째로 날린다.
      const { error } = await client
        .from('uploads')
        .delete()
        .like('filename', `${UPLOAD_CONTRACT_PREFIX}%`);
      if (error) throw new Error(`계약 정리 실패 (uploads, code=${error.code ?? 'UNKNOWN'})`);
    },
  });
} else {
  describe('UploadRecordStore 계약 — supabase', () => {
    it.skip('자격증명이 없어 건너뛴다 (NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY)', () => {});
  });
}
