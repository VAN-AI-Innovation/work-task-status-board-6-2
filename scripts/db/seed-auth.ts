/**
 * 역할 계정(admin·lead·member)과 그 계정이 볼 데이터를 원격 Supabase에 만든다 (T8).
 *
 *   npm run seed:auth
 *   (= npx vite-node -c vitest.config.ts scripts/db/seed-auth.ts)
 *
 * `0003_auth_rls.sql`이 정책을 걸었지만, 그 시점에는 **로그인한 사람이 하나도 없고
 * `members`가 0행이며 `tasks.owner_member_id`가 전부 null**이다. 그 상태에서는 T8 완료
 * 기준 1(세 역할이 각각 다른 범위를 본다)을 잴 수가 없다 — 세 계정과, 적어도 한 계정에
 * 붙은 담당 업무가 있어야 한다. 이 스크립트가 그 최소 상태를 만들고,
 * `scripts/smoke/rls-check.mjs`가 그것으로 정책의 실효를 잰다 (완료 기준 5).
 *
 * ### 규율
 *
 * - **멱등하다.** 두 번 돌려도 결과가 같고 두 번째가 에러 없이 끝난다. 계정을 지우지 않고,
 *   있으면 재사용하며, 비밀번호를 덮어쓰지 않는다.
 * - **지우지 않는다.** 실업무 행·계약 행을 건드리지 않는다.
 * - **이름을 하드코딩하지 않는다.** 담당자 이름·건수를 전부 시드에서 **계산**한다 —
 *   적어 두면 시드가 바뀐 날 조용히 어긋난다.
 * - **매칭 규칙을 다시 쓰지 않는다.** 잔여 백필은 `owner-link.ts`의 `buildOwnerIndex`를
 *   그대로 쓴다. 두 벌이 되면 업로드로 들어온 행과 백필한 행의 기준이 갈린다.
 * - **태스크를 직접 넣지 않는다.** `buildSeedPayload` → `uploads.create` → `commitUpload`,
 *   즉 `/api/uploads/seed`와 **완전히 같은 제품 경로**를 탄다 (`PLAN.md` 9-3).
 * - **출력에 이메일·이름·비밀번호·키를 담지 않는다.** 건수만 찍는다 (`S6`·`X1`).
 *
 * `scripts/`는 번들에 들어가지 않으므로 `next build` 경로에서 import되지 않는다 (`CLAUDE.md`).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { createServiceRoleClient, createSupabaseTaskStore } from '@/lib/store/supabase-task-store';
import { createSupabaseUploadStore } from '@/lib/store/upload-record-store';
import { buildOwnerIndex } from '@/lib/upload/owner-link';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import { commitUpload } from '@/lib/upload/upload-commit';
import type { TeamKey } from '@/types/task';

const ENV_LOCAL = fileURLToPath(new URL('../../.env.local', import.meta.url));

/**
 * `vitest.config.ts`는 Supabase 자격증명 **셋만** `process.env`로 옮긴다. `T8_SEED_*`는
 * 그 목록에 없으므로 여기서 직접 읽는다 — 이 step은 제품 코드를 고치지 않는다.
 */
function readEnvLocal(): Map<string, string> {
  const found = new Map<string, string>();
  let text: string;
  try {
    text = readFileSync(ENV_LOCAL, 'utf8');
  } catch {
    return found;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    found.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return found;
}

/**
 * 비밀번호는 **`.env.local`에만** 산다 (`.gitignore`가 `.env*`를 막고 `.env.example`만 뺀다).
 * 없으면 새로 만들어 **덧붙이고**(기존 줄을 고치지 않는다) 값은 찍지 않는다.
 */
function resolvePassword(envLocal: Map<string, string>): { password: string; created: boolean } {
  const existing = process.env.T8_SEED_PASSWORD ?? envLocal.get('T8_SEED_PASSWORD') ?? '';
  if (existing !== '') return { password: existing, created: false };

  // 32바이트 → base64url 43자. 24자 하한을 넉넉히 넘긴다.
  const password = randomBytes(32).toString('base64url');
  appendFileSync(ENV_LOCAL, `\nT8_SEED_PASSWORD=${password}\n`, 'utf8');
  return { password, created: true };
}

interface AccountSpec {
  local: string;
  role: ViewerRole;
  teamId: TeamKey | null;
}

/** `lead`·`member`가 맡는 팀. 시드에 담당자가 가장 촘촘한 팀이다 */
const DEMO_TEAM: TeamKey = 'edit';

const ACCOUNTS: readonly AccountSpec[] = [
  { local: 'admin', role: 'admin', teamId: null },
  { local: 'lead', role: 'lead', teamId: DEMO_TEAM },
  { local: 'member', role: 'member', teamId: DEMO_TEAM },
];

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

interface OwnerCount {
  teamId: TeamKey;
  name: string;
  count: number;
}

/**
 * 시드에서 팀·담당자 조합과 그 건수를 센다. **이름을 적어 두지 않는 것이 요점이다.**
 * 정렬은 팀 → 건수 내림차순 → 이름 오름차순이라 동률에서도 결과가 결정적이다.
 */
function ownerCounts(
  tasks: readonly { teamId: TeamKey; ownerNameRaw: string | null }[],
): OwnerCount[] {
  const counts = new Map<string, OwnerCount>();
  for (const task of tasks) {
    const name = (task.ownerNameRaw ?? '').trim();
    if (name === '') continue;
    const key = `${task.teamId} ${name}`;
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { teamId: task.teamId, name, count: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => a.teamId.localeCompare(b.teamId) || b.count - a.count || a.name.localeCompare(b.name),
  );
}

async function upsertMembers(
  client: SupabaseClient,
  owners: readonly OwnerCount[],
  known: ReadonlySet<string>,
): Promise<{ created: number; existing: number }> {
  const missing = owners.filter((owner) => !known.has(`${owner.teamId} ${owner.name}`));
  if (missing.length > 0) {
    // `unique (team_id, name)` 위에서의 upsert다 (`0001_init.sql`). 두 번 돌려도 늘지 않는다.
    const { error } = await client
      .from('members')
      .upsert(
        missing.map((owner) => ({ team_id: owner.teamId, name: owner.name })),
        { onConflict: 'team_id,name', ignoreDuplicates: true },
      );
    if (error) die(`members 생성 실패: ${error.code ?? error.message}`);
  }
  return { created: missing.length, existing: owners.length - missing.length };
}

/** Admin API로만 만든다. `auth.users`에 직접 insert하면 identity 행이 빠져 로그인이 안 된다 */
async function ensureAccount(
  client: SupabaseClient,
  email: string,
  password: string,
  existingByEmail: ReadonlyMap<string, string>,
): Promise<{ userId: string; created: boolean }> {
  const found = existingByEmail.get(email);
  // 있으면 비밀번호를 덮어쓰지 않는다 — 사람이 바꿔 뒀을 수 있고, 덮어쓰면 멱등이 아니다.
  if (found) return { userId: found, created: false };

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    // 확인 메일을 기다리면 스크립트가 끝나지 않는다.
    email_confirm: true,
  });
  if (error || !data.user) die(`계정 생성 실패: ${error?.code ?? error?.message ?? 'unknown'}`);
  return { userId: data.user.id, created: true };
}

async function listUsersByEmail(client: SupabaseClient): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  // 계정이 셋뿐인 프로젝트지만 페이지를 끝까지 넘긴다 — 한 페이지만 보면 계정이 늘었을 때
  // 「없다」고 판단해 중복 생성을 시도한다.
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) die(`계정 목록 조회 실패: ${error.code ?? error.message}`);
    for (const user of data.users) {
      if (user.email) byEmail.set(user.email.toLowerCase(), user.id);
    }
    if (data.users.length < perPage) break;
  }
  return byEmail;
}

interface MemberRow {
  id: string;
  team_id: string;
  name: string;
  auth_user_id: string | null;
}

async function readMembers(client: SupabaseClient): Promise<MemberRow[]> {
  const { data, error } = await client
    .from('members')
    .select('id, team_id, name, auth_user_id')
    .order('team_id')
    .order('name');
  if (error) die(`members 조회 실패: ${error.code ?? error.message}`);
  return (data ?? []) as MemberRow[];
}

async function main(): Promise<void> {
  const envLocal = readEnvLocal();
  const client = createServiceRoleClient();
  if (!client) {
    die('NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 없다. .env.local을 채우고 다시 실행하라.');
  }

  const domain =
    process.env.T8_SEED_EMAIL_DOMAIN ?? envLocal.get('T8_SEED_EMAIL_DOMAIN') ?? 'example.com';
  const { password, created: passwordCreated } = resolvePassword(envLocal);
  if (passwordCreated) {
    console.log('.env.local에 T8_SEED_PASSWORD를 새로 기록했다 (값은 찍지 않는다).');
  }

  const payload = buildSeedPayload();
  const owners = ownerCounts(payload.tasks);

  // 1. members
  const before = await readMembers(client);
  const members = await upsertMembers(
    client,
    owners,
    new Set(before.map((row) => `${row.team_id} ${row.name}`)),
  );
  const memberRows = members.created > 0 ? await readMembers(client) : before;
  const memberIdByKey = new Map(memberRows.map((row) => [`${row.team_id} ${row.name}`, row.id]));

  // 2. 계정
  const existingByEmail = await listUsersByEmail(client);
  const userIds = new Map<ViewerRole, string>();
  let accountsCreated = 0;
  for (const spec of ACCOUNTS) {
    const email = `${spec.local}@${domain}`.toLowerCase();
    const { userId, created } = await ensureAccount(client, email, password, existingByEmail);
    userIds.set(spec.role, userId);
    if (created) accountsCreated += 1;
  }

  // 3. profiles
  const { data: profilesBefore, error: profileReadError } = await client
    .from('profiles')
    .select('id');
  if (profileReadError) {
    die(`profiles 조회 실패: ${profileReadError.code ?? profileReadError.message}`);
  }
  const knownProfiles = new Set((profilesBefore ?? []).map((row) => row.id as string));

  const { error: profileError } = await client.from('profiles').upsert(
    ACCOUNTS.map((spec) => ({
      id: userIds.get(spec.role) as string,
      role: spec.role,
      team_id: spec.teamId,
    })),
    { onConflict: 'id' },
  );
  if (profileError) die(`profiles 반영 실패: ${profileError.code ?? profileError.message}`);
  const profilesCreated = ACCOUNTS.filter(
    (spec) => !knownProfiles.has(userIds.get(spec.role) as string),
  ).length;

  // 4. members.auth_user_id 연결
  //
  // `member` 계정은 **데모 팀에서 태스크가 가장 많은 이름**에 잇는다. 「가장 많은」을 여기서
  // 계산하는 이유는 완료 기준 1의 `member` 화면이 빈 화면이면 아무것도 증명하지 못하기
  // 때문이고, 시드가 바뀌어도 따라가야 하기 때문이다. `lead`도 같은 팀의 다른 이름 하나에
  // 잇는다 — 팀장도 자기 담당 업무가 있다. `admin`은 잇지 않는다(전사 역할이라 담당자 축이
  // 없다).
  const teamOwners = owners.filter((owner) => owner.teamId === DEMO_TEAM);
  if (teamOwners.length < 2) {
    die(`시드의 ${DEMO_TEAM} 팀 담당자가 ${teamOwners.length}명이라 두 계정을 이을 수 없다.`);
  }
  const links = (['member', 'lead'] as const).map((role, index) => {
    const owner = teamOwners[index];
    const memberId = memberIdByKey.get(`${owner.teamId} ${owner.name}`);
    if (!memberId) die('구성원 행을 찾지 못했다. members 생성이 반영되지 않았다.');
    return { role: role as ViewerRole, memberId };
  });

  let linksChanged = 0;
  for (const link of links) {
    const userId = userIds.get(link.role) as string;
    if (memberRows.find((row) => row.id === link.memberId)?.auth_user_id === userId) continue;
    const { error } = await client
      .from('members')
      .update({ auth_user_id: userId })
      .eq('id', link.memberId);
    if (error) die(`구성원 연결 실패: ${error.code ?? error.message}`);
    linksChanged += 1;
  }

  // 5. 시드 태스크 확정 — 제품 경로 그대로다
  const seedKeys = payload.tasks.map((task) => task.sourceKey);
  const { count: seedPresent, error: presentError } = await client
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .in('source_key', seedKeys);
  if (presentError) die(`tasks 조회 실패: ${presentError.code ?? presentError.message}`);

  let committed = 0;
  if ((seedPresent ?? 0) < seedKeys.length) {
    const uploads = createSupabaseUploadStore(client);
    const now = new Date().toISOString();
    const record = await uploads.create({
      kind: 'sheet',
      filename: 'seed-tasks.json',
      parseResult: payload,
      createdAt: now,
    });
    const outcome = await commitUpload(
      { repo: createSupabaseTaskStore(client), uploads, readOnly: false },
      record.id,
      now,
    );
    if (!outcome.ok) die(`시드 확정 실패: ${outcome.code}`);
    committed = outcome.summary.created + outcome.summary.updated;
  }

  // 6. 잔여 백필
  //
  // 규칙을 다시 쓰지 않는다 — `owner-link.ts`가 쓰는 인덱스를 그대로 쓴다. 같은 팀 안에서만,
  // 같은 정규화로, 충돌하면 붙이지 않는다.
  const index = buildOwnerIndex(
    (await readMembers(client)).map((row) => ({
      id: row.id,
      teamId: row.team_id as TeamKey,
      name: row.name,
      authUserId: row.auth_user_id,
    })),
  );

  const { data: orphans, error: orphanError } = await client
    .from('tasks')
    .select('id, team_id, owner_name_raw')
    .is('owner_member_id', null)
    .not('owner_name_raw', 'is', null);
  if (orphanError) die(`tasks 백필 조회 실패: ${orphanError.code ?? orphanError.message}`);

  let backfilled = 0;
  for (const row of orphans ?? []) {
    const memberId = index.get(row.team_id as TeamKey, (row.owner_name_raw as string) ?? '');
    if (memberId === null) continue;
    const { error } = await client
      .from('tasks')
      .update({ owner_member_id: memberId })
      .eq('id', row.id as string);
    if (error) die(`tasks 백필 실패: ${error.code ?? error.message}`);
    backfilled += 1;
  }

  const { count: ownedCount } = await client
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .not('owner_member_id', 'is', null);

  console.log(
    [
      `members     생성 ${members.created} / 이미 있음 ${members.existing}`,
      `계정        생성 ${accountsCreated} / 이미 있음 ${ACCOUNTS.length - accountsCreated}`,
      `profiles    생성 ${profilesCreated} / 이미 있음 ${ACCOUNTS.length - profilesCreated}`,
      `구성원 연결  변경 ${linksChanged} / 이미 연결 ${links.length - linksChanged}`,
      `시드 태스크  확정 ${committed}건 (이미 있으면 0)`,
      `담당자 백필  ${backfilled}건 · 담당자 붙은 태스크 ${ownedCount ?? 0}건`,
    ].join('\n'),
  );
}

await main();
