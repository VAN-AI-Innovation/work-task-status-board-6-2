/**
 * RLS가 **실제로 걸리는지**를 세 계정으로 로그인해 잰다 (`docs/TICKETS.md` T8 완료 기준 5,
 * 그리고 완료 기준 2의 DB 층).
 *
 * 정책은 「걸었다」로 증명되지 않는다. `0003_auth_rls.sql`을 적용했다는 사실과 「세 역할이
 * 각각 다른 범위를 본다」는 사실 사이에는 로그인·JWT·PostgREST가 있고, 그 사이 어디가
 * 어긋나도 마이그레이션은 통과한 채로 남는다. **여기서 재는 것은 보이는 건수다.**
 *
 * ### anon 키로만 잰다
 *
 * `service_role`은 RLS를 우회한다. 그 키로 재면 이 스크립트는 아무것도 재지 않으면서
 * 전부 통과한다 — 가장 위험한 실패 모양이다. 그래서 첫머리에서 두 키가 같으면 즉시 죽는다.
 * `service_role` 클라이언트는 **기대값을 세는 용도로만** 따로 만든다.
 *
 * ### 기대값을 적어 두지 않는다
 *
 * 3·4의 숫자는 `service_role`로 그때그때 센다. 하드코딩하면 시드가 바뀐 날 조용히 통과한다.
 *
 * 실행:
 *   node --env-file=.env.local scripts/smoke/rls-check.mjs
 *
 * 출력에 업무명·담당자 이름·이메일·셀 값을 담지 않는다 — 항목 번호와 건수뿐이다 (`X1`·`S6`).
 */
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.T8_SEED_PASSWORD;
const domain = process.env.T8_SEED_EMAIL_DOMAIN ?? 'example.com';

if (!url || !anonKey || !serviceKey || !password) {
  console.error(
    '환경변수가 모자란다. 다음처럼 실행하라:\n' +
      '  node --env-file=.env.local scripts/smoke/rls-check.mjs\n' +
      '필요한 키: NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY · ' +
      'SUPABASE_SERVICE_ROLE_KEY · T8_SEED_PASSWORD',
  );
  process.exit(2);
}

// 이 스크립트의 존재 이유를 지키는 가드다. 같은 키면 RLS가 우회돼 전부 통과한다.
if (anonKey === serviceKey) {
  console.error('anon 자리에 service_role 키가 들어 있다. 이 키로 재면 RLS가 우회돼 아무것도 재지 않는다.');
  process.exit(2);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function anonClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(local) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: `${local}@${domain}`,
    password,
  });
  if (error) {
    console.error(`로그인 실패(${local}): ${error.code ?? error.message}`);
    process.exit(1);
  }
  return client;
}

/** 행 수만 센다. 권한 오류는 -1로 구분한다 (0행과 「못 읽는다」는 다른 사실이다) */
async function countRows(client, table) {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
  if (error) return -1;
  return count ?? 0;
}

const results = [];
let failed = 0;

function check(no, label, ok, detail) {
  results.push({ no, label, ok, detail });
  if (!ok) failed += 1;
}

// --- 기대값 (service_role로 그때그때 센다) --------------------------------
const { count: totalTasks } = await admin
  .from('tasks')
  .select('id', { count: 'exact', head: true });

const { data: profiles, error: profileError } = await admin
  .from('profiles')
  .select('id, role, team_id');
if (profileError) {
  console.error(`profiles 조회 실패: ${profileError.code ?? profileError.message}`);
  process.exit(1);
}
const leadProfile = profiles.find((row) => row.role === 'lead');
const memberProfile = profiles.find((row) => row.role === 'member');
if (!leadProfile || !memberProfile) {
  console.error('lead·member 프로필이 없다. npm run seed:auth를 먼저 돌려라.');
  process.exit(1);
}

const { count: leadTeamTasks } = await admin
  .from('tasks')
  .select('id', { count: 'exact', head: true })
  .eq('team_id', leadProfile.team_id);

const { data: memberRow } = await admin
  .from('members')
  .select('id')
  .eq('auth_user_id', memberProfile.id)
  .order('id')
  .limit(1)
  .maybeSingle();
if (!memberRow) {
  console.error('member 계정에 이어진 구성원 행이 없다. npm run seed:auth를 먼저 돌려라.');
  process.exit(1);
}

const { data: ownTasks } = await admin
  .from('tasks')
  .select('id, status')
  .eq('owner_member_id', memberRow.id)
  .order('id');
const { data: otherTasks } = await admin
  .from('tasks')
  .select('id')
  .neq('owner_member_id', memberRow.id)
  .order('id')
  .limit(1);
const ownTaskCount = (ownTasks ?? []).length;

// --- 1. 로그아웃 상태 -----------------------------------------------------
const guest = anonClient();
const guestTasks = await countRows(guest, 'tasks');
check(1, '로그아웃 상태에서 tasks 조회', guestTasks <= 0, `보인 행 ${Math.max(guestTasks, 0)}`);

// --- 2~5. 역할별 열람 범위 ------------------------------------------------
const adminClient = await signIn('admin');
const leadClient = await signIn('lead');
const memberClient = await signIn('member');

const adminCount = await countRows(adminClient, 'tasks');
const leadCount = await countRows(leadClient, 'tasks');
const memberCount = await countRows(memberClient, 'tasks');

check(2, 'admin이 전체를 본다', adminCount === totalTasks, `${adminCount} / 전체 ${totalTasks}`);
check(
  3,
  'lead가 자기 팀만 본다',
  leadCount === leadTeamTasks && leadCount < totalTasks,
  `${leadCount} / 팀 ${leadTeamTasks} / 전체 ${totalTasks}`,
);
check(
  4,
  'member가 자기 담당만 본다',
  memberCount === ownTaskCount && memberCount >= 1 && memberCount < leadCount,
  `${memberCount} / 담당 ${ownTaskCount} / lead ${leadCount}`,
);
check(
  5,
  '세 역할의 건수가 서로 다르다',
  new Set([adminCount, leadCount, memberCount]).size === 3,
  `admin ${adminCount} · lead ${leadCount} · member ${memberCount}`,
);

// --- 6~8. 수정 권한 -------------------------------------------------------
//
// 6은 정책(어느 행)을, 8은 GRANT(어느 컬럼)를 잰다. 둘은 다른 자물쇠라 따로 재야 한다.
const otherTaskId = (otherTasks ?? [])[0]?.id ?? null;
if (otherTaskId === null) {
  check(6, '남의 태스크 수정이 막힌다', false, '비교할 남의 태스크가 없다');
} else {
  const { data, error } = await memberClient
    .from('tasks')
    .update({ status: 'rls-check' })
    .eq('id', otherTaskId)
    .select('id');
  const changed = error ? -1 : (data ?? []).length;
  check(6, '남의 태스크 수정이 막힌다', changed <= 0, `갱신 ${Math.max(changed, 0)}행`);
}

const ownTask = (ownTasks ?? [])[0] ?? null;
if (ownTask === null) {
  check(7, '자기 태스크는 수정된다', false, '담당 태스크가 없다');
  check(8, 'title 컬럼 수정이 막힌다', false, '담당 태스크가 없다');
} else {
  const probe = ownTask.status === null ? 'rls-check' : `${ownTask.status} `;
  const { data, error } = await memberClient
    .from('tasks')
    .update({ status: probe })
    .eq('id', ownTask.id)
    .select('id');
  const changed = error ? -1 : (data ?? []).length;
  check(7, '자기 태스크는 수정된다', changed === 1, `갱신 ${Math.max(changed, 0)}행`);

  // 원래 값으로 되돌린다. 이 스크립트는 데이터를 남기지 않는다.
  const { error: revertError } = await admin
    .from('tasks')
    .update({ status: ownTask.status })
    .eq('id', ownTask.id);
  if (revertError) {
    console.error(`되돌리기 실패: ${revertError.code ?? revertError.message}`);
    process.exit(1);
  }

  // grant update (status, progress, updated_at)에 title이 없다 → 42501
  const { data: titleData, error: titleError } = await memberClient
    .from('tasks')
    .update({ title: 'rls-check' })
    .eq('id', ownTask.id)
    .select('id');
  const titleChanged = titleError ? -1 : (titleData ?? []).length;
  check(
    8,
    'title 컬럼 수정이 막힌다',
    titleChanged < 0,
    titleError ? `거부 ${titleError.code ?? 'error'}` : `갱신 ${titleChanged}행`,
  );
}

// --- 9~10. 서버 전용 테이블과 프로필 --------------------------------------
const memberUploads = await countRows(memberClient, 'uploads');
check(9, 'member가 uploads를 못 읽는다', memberUploads <= 0, `보인 행 ${Math.max(memberUploads, 0)}`);

const adminProfiles = await countRows(adminClient, 'profiles');
check(10, 'admin도 프로필은 자기 것만 본다', adminProfiles === 1, `보인 행 ${adminProfiles}`);

// --- 11~14. 이력 열람 (task_events · 0004_events_policy.sql) ----------------
//
// `task_events_select_via_task`는 범위 조건을 스스로 적지 않고 부모 tasks 정책을 다시 탄다
// (결정 K · ADR-028). 그러므로 여기서 재는 것은 「이력이 업무와 **같은 범위**로 보이는가」다.
//
// ⚠ 원격 task_events는 0행일 수 있다 — 확정이 멱등이라 같은 시트를 다시 올리면 전건
//   unchanged이고 이벤트가 0건이기 때문이다 (UC-03·X4). 0행이면 세 숫자가 전부 0이라
//   **정책이 듣는지 알 수 없고 그것은 PASS가 아니다.** 그래서 잴 수 있는 상태를 직접
//   만든다 — service_role로 이벤트 둘을 넣고(내 업무 하나 · 남의 업무 하나) 재고, **넣은
//   것만** 지운다. 기존 행은 건드리지 않는다.
//
// changed_fields에는 **필드 이름만** 담는다. 값을 담으면 이력 테이블이 개인정보 사본이
// 된다 (S6 · 0001_init.sql의 같은 주석).
let probeEventIds = [];

if (ownTask === null || otherTaskId === null) {
  const reason = ownTask === null ? '담당 태스크가 없다' : '비교할 남의 태스크가 없다';
  for (const [no, label] of [
    [11, '로그아웃 상태에서 task_events 조회'],
    [12, 'admin이 이력 전체를 본다'],
    [13, 'member가 자기 업무의 이력만 본다'],
    [14, '남의 업무 이력을 task_id로 직접 지정해도 막힌다'],
  ]) {
    check(no, label, false, `검증 불가 — ${reason}`);
  }
} else {
  const occurredAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await admin
    .from('task_events')
    .insert([
      { task_id: ownTask.id, changed_fields: ['status'], occurred_at: occurredAt },
      { task_id: otherTaskId, changed_fields: ['progress'], occurred_at: occurredAt },
    ])
    .select('id');
  if (insertError) {
    console.error(`검증용 이력 생성 실패: ${insertError.code ?? insertError.message}`);
    process.exit(1);
  }
  probeEventIds = (inserted ?? []).map((row) => row.id);

  // 기대값은 여기서도 하드코딩하지 않는다 — service_role로 그때그때 센다.
  const { count: totalEvents } = await admin
    .from('task_events')
    .select('id', { count: 'exact', head: true });
  const ownTaskIds = (ownTasks ?? []).map((row) => row.id);
  const { count: ownEvents } = await admin
    .from('task_events')
    .select('id', { count: 'exact', head: true })
    .in('task_id', ownTaskIds);

  const guestEvents = await countRows(anonClient(), 'task_events');
  check(
    11,
    '로그아웃 상태에서 task_events 조회',
    guestEvents <= 0,
    `보인 행 ${Math.max(guestEvents, 0)}`,
  );

  const adminEvents = await countRows(adminClient, 'task_events');
  const memberEvents = await countRows(memberClient, 'task_events');
  check(12, 'admin이 이력 전체를 본다', adminEvents === totalEvents, `${adminEvents} / 전체 ${totalEvents}`);
  check(
    13,
    'member가 자기 업무의 이력만 본다',
    memberEvents === ownEvents && memberEvents >= 1 && memberEvents < adminEvents,
    `${memberEvents} / 담당 ${ownEvents} / admin ${adminEvents}`,
  );

  // task_id를 직접 짚어도 부모 tasks 정책이 그 행을 막으므로 exists가 거짓이다.
  const { data: peeked, error: peekError } = await memberClient
    .from('task_events')
    .select('id')
    .eq('task_id', otherTaskId);
  const peekedRows = peekError ? -1 : (peeked ?? []).length;
  check(
    14,
    '남의 업무 이력을 task_id로 직접 지정해도 막힌다',
    peekedRows <= 0,
    peekError ? `거부 ${peekError.code ?? 'error'}` : `보인 행 ${peekedRows}`,
  );
}

// 넣은 것만 지운다. 이 스크립트는 데이터를 남기지 않는다.
if (probeEventIds.length > 0) {
  const { error: cleanupError } = await admin.from('task_events').delete().in('id', probeEventIds);
  if (cleanupError) {
    console.error(`검증용 이력 정리 실패: ${cleanupError.code ?? cleanupError.message}`);
    process.exit(1);
  }
}

// --- 결과 ------------------------------------------------------------------
console.log('| # | 항목 | 판정 | 실측 |');
console.log('|---|---|---|---|');
for (const row of results) {
  console.log(`| ${row.no} | ${row.label} | ${row.ok ? 'PASS' : 'FAIL'} | ${row.detail} |`);
}

await Promise.all(
  [adminClient, leadClient, memberClient].map((client) => client.auth.signOut()),
);

if (failed > 0) {
  console.error(`\n${failed}개 항목 실패.`);
  process.exit(1);
}
console.log(`\n${results.length}개 항목 전부 통과.`);
