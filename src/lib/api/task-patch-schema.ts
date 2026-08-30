/**
 * `PATCH /api/tasks/[id]`의 문 앞 검증. **업무 패널의 「수정」 칸이 여는 필드 전부**가 여기
 * 열거돼 있고, 같은 목록을 `task-create-schema.ts`가 재사용한다.
 *
 * ## 왜 넷에서 늘었나
 *
 * 오래도록 `status`·`progress`(+담당자 두 칸)뿐이었고, 근거는 「시트가 진실의 원천이라
 * (`ADR-001`) 재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는 **자기 수정이 조용히
 * 사라지는 것**을 본다」였다.
 *
 * 그 근거는 **여전히 참이지만 결론이 바뀌었다.** 회의 중에 마감을 하루 미루고 다음 조치를
 * 고쳐 적는 일이 실제로 일어나는데, 그때마다 시트를 열어 고치고 다시 업로드하는 것은
 * 「시트 업로드만으로 통합 조회」라는 이 제품의 약속과 어긋난다. 그래서 **덮어쓴다는 사실을
 * 감추는 대신 화면이 말한다** (`task-detail-fields.tsx`가 「다음 시트 업로드가 덮어씁니다」를
 * 폼 안에 적는다).
 *
 * 그래도 여는 기준은 그대로다: 「사람이 오늘 바꾸는 것」과 「다음 업로드가 가져오는 것」이
 * 겹치는 자리인가. **`raw`·`source_*`는 열지 않는다** — 그쪽은 시트 원본과 감사 기록이다.
 * DB의 컬럼 GRANT가 같은 목록을 진다 (`0013_task_authoring.sql` 5절 · `0014`).
 *
 * ## `extras`는 **팀 전용 칸이라서** 열었다
 *
 * 오래 닫아 두었고 근거는 「열면 이 화면이 시트 편집기가 된다」였다. 뒤집은 이유는 팀 전용
 * 컬럼(`콘텐츠 유형`·`섭외 상태` …)이 **전부 그 안에 있기 때문이다** — 공통 13칸만 열어 두면
 * 촬영팀 사람이 자기 업무의 절반을 화면에서 못 고친다. 대신 셋을 지킨다.
 *
 * - **키를 새로 만들 수는 있어도 민감 키는 못 쓴다** (`isSensitiveExtraKey`). 연락처·계정이
 *   화면 입력으로 들어오는 길을 막는다 (`S6`).
 * - **값은 문자열이나 `null`뿐이다.** 하이퍼링크 객체(`{text,hyperlink}`)는 시트만 만든다.
 * - **덮어쓰지 않고 합친다.** 보낸 키만 바뀐다 — 라우트가 기존 `extras`에 얹는다.
 *
 * ## 담당자는 **id만** 받는다
 *
 * 이름(`ownerNameRaw`·`coOwnerNames`)은 클라이언트에서 받지 않고 라우트가 id에서 유도한다.
 * 둘을 따로 받으면 「담당자는 A인데 이름은 B」인 행을 만들 수 있고, 그 행은 화면에서 데이터가
 * 틀린 것으로 보인다.
 *
 * ## 담당자가 여럿일 수 있다 — 다만 **주 담당은 하나다**
 *
 * `ownerMemberId`(주 담당)와 `coOwnerMemberIds`(공동 담당)로 나눈다. 시트가 그 모양이고
 * (「담당자」 칸과 「공동 담당」 칸), 무엇보다 **`member`의 열람 범위가 주 담당 하나로
 * 정해지기 때문이다** (`viewer-scope.ts` · RLS). 평평한 목록으로 받아 첫 번째를 주 담당으로
 * 삼으면, 화면에서 순서를 바꾸는 것만으로 누가 그 업무를 보는지가 조용히 바뀐다.
 *
 * ## 단계도 **같은 요청에** 실린다
 *
 * `stages`는 `task_stages` 행들의 부분 수정이다. 별도 라우트로 나누지 않은 이유는 화면의
 * 「저장」이 하나이기 때문이다 — 업무 칸과 단계를 두 요청으로 보내면 그 사이에 화면이 다시
 * 그려지는 순간이 생기고, 사용자는 자기가 만들지 않은 중간 상태를 본다 (담당자 두 칸을
 * 함께 보내는 규칙 그대로다). 「그 단계가 이 업무의 것인가」는 모양이 아니라 데이터라
 * 라우트가 본다.
 *
 * `.strict()`인 이유는 `assignment-schema.ts`와 같다: 모르는 키를 조용히 버리면 클라이언트가
 * 잘못된 모양을 보내고도 200을 받아, 안 바뀐 값을 나중에 화면에서야 발견한다.
 *
 * **권한을 판정하지 않는다.** 여기서 보는 것은 모양뿐이고, 「누가 무엇을 고칠 수 있나」는
 * `viewer-scope.ts`(앱)와 RLS·컬럼 GRANT(DB)가 진다.
 */

import { z } from 'zod';

import { isSensitiveExtraKey } from '@/lib/domain/extras-visibility';


/** 상태 원문의 상한. 시트 드롭다운 한 칸이라 이보다 길면 상태가 아니다 */
export const TASK_STATUS_MAX_LENGTH = 100;

/** 업무명. 시트의 한 칸이라 문장 하나 길이면 넉넉하다 */
export const TASK_TITLE_MAX_LENGTH = 300;

/** 우선순위·리스크·승인처럼 드롭다운 한 칸에서 오는 짧은 원문 */
export const TASK_LABEL_MAX_LENGTH = 100;

/** 다음 조치·지연 사유·비고처럼 사람이 문장으로 적는 칸 */
export const TASK_TEXT_MAX_LENGTH = 2_000;

/** `YYYY-MM-DD`. 저장소의 `date` 컬럼과 같은 모양이다 — 시각을 섞지 않는다 (`E4`) */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 상태를 **enum으로 좁히지 않는다** (`ADR-009`). 시트의 진행 상태 값은 `설정` 탭에서 오고
 * 늘어난다 — 미등록 값은 파서에서 **경고**이지 거부가 아니고, 그 규율이 여기서만 뒤집히면
 * 시트에 새 단계를 추가한 날 화면이 400을 뱉는다.
 *
 * `null`은 받지 않는다. 상태를 지우는 것은 「빈 셀」을 만드는 일이고, 그것은 업로드가 하는
 * 일이지 사람이 화면에서 하는 일이 아니다.
 */
const statusSchema = z.string().trim().min(1).max(TASK_STATUS_MAX_LENGTH);

/**
 * `null`은 「값을 지운다」이고 키 없음(`undefined`)은 「안 건드린다」다. **둘이 다르다** —
 * 빈 셀과 0을 구분하는 것이 이 프로젝트의 오래된 규칙이다 (`types/task.ts`).
 */
const progressSchema = z.number().int().min(0).max(100).nullable();

/**
 * 담당자로 세울 `members.id`. **`null`은 「담당자를 비운다」**이고 키 없음은 「안 건드린다」다 —
 * `progress`와 같은 규칙이다.
 *
 * uuid로 좁히는 것은 모양 검사이지 권한이 아니다. 「그 구성원이 이 업무의 팀인가」는 라우트가
 * `assignableMembers`로 보고, 「이 역할이 담당자를 바꿀 수 있는가」는 `canAssignOwner`와
 * `tasks_update_scope`가 진다.
 */
const ownerMemberIdSchema = z.uuid().nullable();

/**
 * **업무명은 비울 수 없다.** `null`을 받으면 이름 없는 업무가 생기고, 표에서 그 줄은
 * 「—」 하나로 서서 무엇인지 알 수 없다. 지우는 것은 이제 삭제가 한다 (`DELETE`).
 */
const titleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH);

/**
 * 드롭다운 한 칸의 원문. **`null`은 「비운다」**이고 키 없음은 「안 건드린다」다 —
 * `progress`와 같은 규칙이다. 빈 문자열은 `null`로 접는다: 시트의 빈 셀이 그것이고,
 * 「지웠다」와 「빈 문자열을 넣었다」를 가를 이유가 없다.
 */
const labelSchema = z
  .string()
  .trim()
  .max(TASK_LABEL_MAX_LENGTH)
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value));

/** 사람이 문장으로 적는 칸. 위와 같은 규칙, 상한만 다르다 */
const textSchema = z
  .string()
  .trim()
  .max(TASK_TEXT_MAX_LENGTH)
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value));

/**
 * 날짜 한 칸. **문자열로만 다룬다** — `Date`로 만들면 시간대가 끼어들어 하루가 어긋난다
 * (`E4` · `supabase-task-store.ts`의 같은 주석). 빈 문자열은 `null`이다.
 */
const dateSchema = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value))
  .refine((value) => value === null || ISO_DATE.test(value), {
    message: 'YYYY-MM-DD 형식이어야 합니다.',
  });

/**
 * **패치와 생성이 공유하는 필드 표.** 두 벌로 두면 한쪽만 늘어나는 날이 오고, 그때
 * 「만들 때는 넣을 수 있는데 고칠 수는 없는 칸」이 생긴다.
 */
export const TASK_EDITABLE_FIELDS = {
  title: titleSchema,
  status: statusSchema,
  progress: progressSchema,
  priority: labelSchema,
  riskStatus: labelSchema,
  approvalStatus: labelSchema,
  assignedAt: dateSchema,
  dueAt: dateSchema,
  nextAction: textSchema,
  nextActionOwner: labelSchema,
  nextActionDue: dateSchema,
  delayReason: textSchema,
  note: textSchema,
} as const;

/**
 * 공동 담당자의 `members.id` 목록. **빈 배열은 「공동 담당을 비운다」**이고 키 없음은
 * 「안 건드린다」다.
 *
 * 상한을 두는 것은 한 업무에 명부 전체를 실어 보내는 요청을 문 앞에서 자르기 위해서다 —
 * 팀 하나의 인원을 훌쩍 넘는 수라 정상 사용에는 닿지 않는다. 중복·주 담당과의 겹침은
 * 여기서 보지 않는다: 그것은 모양이 아니라 **그 업무의 팀 명부**를 알아야 하는 판정이라
 * 라우트가 진다.
 */
const CO_OWNER_MAX = 20;

const coOwnerMemberIdsSchema = z.array(z.uuid()).max(CO_OWNER_MAX);

/** 한 업무의 팀 전용 칸 수. 실제 탭이 20~30컬럼이라 이보다 많으면 시트가 아니다 */
const EXTRAS_MAX_KEYS = 60;

/**
 * 팀 전용 칸. **키는 시트 헤더 원문**이고 값은 문자열이나 `null`(비운다)뿐이다.
 * 민감 키는 문 앞에서 막는다 — 판정은 다시 쓰지 않고 도메인 것을 부른다 (`S6`).
 */
export const EXTRAS_FIELD = z
  .record(
    z.string().trim().min(1).max(TASK_LABEL_MAX_LENGTH),
    z
      .string()
      .trim()
      .max(TASK_TEXT_MAX_LENGTH)
      .nullable()
      .transform((value) => (value === null || value === '' ? null : value))
  )
  .refine((extras) => Object.keys(extras).length <= EXTRAS_MAX_KEYS, {
    message: '한 번에 바꿀 수 있는 칸 수를 넘었습니다.',
  })
  .refine((extras) => !Object.keys(extras).some(isSensitiveExtraKey), {
    message: '연락처·계정이 든 칸은 화면에서 고칠 수 없습니다.',
  });

/**
 * 단계 한 줄. **`id` + 고칠 칸 넷**이고, 구조(`seq`·`stageKey`·`stageLabel`·`slaDays`)는
 * 없다 — 그것은 시트가 정하고 다음 업로드가 통째로 교체한다 (`types/auth.ts`의 머리말).
 *
 * `id`만 있는 줄을 거부하는 이유는 `{}` 본문을 거부하는 것과 같다: 아무것도 안 바꾸는 줄에
 * 성공을 주면 클라이언트 버그가 저장으로 보인다.
 */
const stagePatchSchema = z
  .object({
    id: z.uuid(),
    plannedDate: dateSchema.optional(),
    actualDate: dateSchema.optional(),
    confirmStatus: labelSchema.optional(),
    content: textSchema.optional(),
  })
  .strict()
  .refine((stage) => Object.keys(stage).length > 1, {
    message: '바꿀 값이 없는 단계가 있습니다.',
  });

/**
 * 한 업무의 단계 수 상한. 실제 편집팀 탭이 단계 셋이라 넉넉하다.
 *
 * **같은 `id`를 두 번 싣지 못한다.** 뒤엣것이 이기는지 앞엣것이 이기는지 정할 근거가 없고,
 * 화면은 애초에 그런 요청을 만들지 않는다 — 만든다면 그것은 버그이지 뜻이 아니다.
 */
const STAGES_MAX = 30;

const stagesSchema = z
  .array(stagePatchSchema)
  .min(1)
  .max(STAGES_MAX)
  .refine((stages) => new Set(stages.map((stage) => stage.id)).size === stages.length, {
    message: '같은 단계를 두 번 보낼 수 없습니다.',
  });

/**
 * 키가 하나도 없는 본문(`{}`)은 거부한다. 아무것도 안 바꾸는 요청에 200을 주면 클라이언트
 * 버그가 **성공으로 보인다** — 사용자는 저장됐다고 믿고 화면을 닫는다.
 */
/**
 * ⚠ 출력 타입이 `TaskPatch`와 **일부러 다르다.** 클라이언트가 보내는 것은 id(`coOwnerMemberIds`)
 * 이고 저장소로 가는 것은 이름(`coOwnerNames`)이라, 그 사이를 라우트가 잇는다.
 */
export const taskPatchSchema = z
  .object({
    title: TASK_EDITABLE_FIELDS.title.optional(),
    status: TASK_EDITABLE_FIELDS.status.optional(),
    progress: TASK_EDITABLE_FIELDS.progress.optional(),
    priority: TASK_EDITABLE_FIELDS.priority.optional(),
    riskStatus: TASK_EDITABLE_FIELDS.riskStatus.optional(),
    approvalStatus: TASK_EDITABLE_FIELDS.approvalStatus.optional(),
    assignedAt: TASK_EDITABLE_FIELDS.assignedAt.optional(),
    dueAt: TASK_EDITABLE_FIELDS.dueAt.optional(),
    nextAction: TASK_EDITABLE_FIELDS.nextAction.optional(),
    nextActionOwner: TASK_EDITABLE_FIELDS.nextActionOwner.optional(),
    nextActionDue: TASK_EDITABLE_FIELDS.nextActionDue.optional(),
    delayReason: TASK_EDITABLE_FIELDS.delayReason.optional(),
    note: TASK_EDITABLE_FIELDS.note.optional(),
    ownerMemberId: ownerMemberIdSchema.optional(),
    coOwnerMemberIds: coOwnerMemberIdsSchema.optional(),
    extras: EXTRAS_FIELD.optional(),
    stages: stagesSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: '바꿀 값이 없습니다.',
  });
