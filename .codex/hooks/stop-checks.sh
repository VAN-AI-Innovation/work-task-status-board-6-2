#!/bin/bash
# Stop 훅 — 턴 종료 시 lint/build/test 를 실행해 품질 게이트를 강제한다.
# Codex Stop 훅은 exit 0 시 stdout 에 JSON 을 요구한다(plain text 는 무효).
# 검사 실패 시 decision:"block" 으로 Codex 가 수정을 이어가도록 한다.

INPUT=$(cat)

# 이미 한 번 Stop 훅으로 이어진 턴이면 재차단하지 않는다(무한 루프 방지).
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ]; then
  echo '{}'
  exit 0
fi

# package.json 이 없으면(템플릿 초기 상태) 검사를 건너뛴다.
if [ ! -f package.json ]; then
  echo '{}'
  exit 0
fi

if OUTPUT=$(npm run lint 2>&1 && npm run build 2>&1 && npm run test 2>&1); then
  echo '{}'
  exit 0
fi

jq -cn --arg r "품질 검사(lint/build/test) 실패. 아래 오류를 수정한 뒤 계속하라:
$OUTPUT" '{decision: "block", reason: $r}'
exit 0
