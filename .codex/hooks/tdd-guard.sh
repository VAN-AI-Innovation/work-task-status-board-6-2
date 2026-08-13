#!/bin/bash
# TDD Guard Hook — Codex PreToolUse[apply_patch|Edit|Write]
# 구현 코드를 작성/수정하려 할 때, 해당 모듈의 테스트 파일이 먼저 존재하는지 체크.
# 테스트 없이 구현 코드를 작성하려 하면 차단한다.
#
# Codex는 훅에 JSON을 stdin으로 전달한다. 파일 편집은 apply_patch 툴을 통하며
# tool_input.command 안에 "*** Add File: <path>" / "*** Update File: <path>"
# 형태로 대상 경로가 들어있다. (Claude 계열의 tool_input.file_path 도 함께 지원)

INPUT=$(cat)

# 대상 파일 경로 수집: 직접 file_path 우선, 없으면 apply_patch 패치에서 추출
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [ -n "$FILE_PATH" ]; then
  FILES="$FILE_PATH"
else
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
  FILES=$(printf '%s\n' "$CMD" | sed -nE 's/^\*\*\* (Add|Update) File: (.*)$/\2/p')
fi

# 대상 파일이 없으면 통과
[ -z "$FILES" ] && exit 0

deny() {
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "$1"
  }
}
EOF
  exit 0
}

# 인자 파일에 테스트가 필요한데 없으면 0(true), 아니면 1(false)
needs_test() {
  local FILE_PATH="$1"

  # 테스트 파일 자체를 수정하는 건 허용
  case "$FILE_PATH" in
    *test*|*spec*|*.test.*|*.spec.*|*__tests__*) return 1 ;;
  esac
  # 설정/타입/스타일 파일은 테스트 불필요 — 허용
  case "$FILE_PATH" in
    *.json|*.css|*.scss|*.md|*.yml|*.yaml|*.env*|*.config.*|*tailwind*|*postcss*|*next.config*|*tsconfig*) return 1 ;;
  esac
  # types/ 폴더는 테스트 불필요 — 허용
  case "$FILE_PATH" in
    */types/*|*/types.ts|*/types.d.ts) return 1 ;;
  esac
  # Next.js 프레임워크 파일은 허용
  case "$FILE_PATH" in
    */layout.tsx|*/layout.ts|*/page.tsx|*/page.ts|*/loading.tsx|*/error.tsx|*/not-found.tsx|*/globals.css) return 1 ;;
  esac
  # components/ 는 presentation 레이어 — 허용 (로직은 lib/ 에 두고 거기서 TDD 강제)
  case "$FILE_PATH" in
    */components/*) return 1 ;;
  esac
  # lib/ 또는 소스 파일만 테스트 요구
  case "$FILE_PATH" in
    *.ts|*.tsx|*.js|*.jsx) ;;
    *) return 1 ;;
  esac

  local DIR BASENAME
  DIR=$(dirname "$FILE_PATH")
  BASENAME=$(basename "$FILE_PATH" | sed -E 's/\.(ts|tsx|js|jsx)$//')

  # 같은 폴더에 .test/.spec 파일
  for EXT in ts tsx js jsx; do
    if [ -f "${DIR}/${BASENAME}.test.${EXT}" ] || [ -f "${DIR}/${BASENAME}.spec.${EXT}" ]; then return 1; fi
  done
  # __tests__ 폴더
  local PARENT
  PARENT=$(dirname "$DIR")
  for EXT in ts tsx js jsx; do
    if [ -f "${PARENT}/__tests__/${BASENAME}.test.${EXT}" ] || [ -f "${DIR}/__tests__/${BASENAME}.test.${EXT}" ]; then return 1; fi
  done
  # src/__tests__/ 루트 테스트 폴더
  local PROJECT_ROOT
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
  for EXT in ts tsx js jsx; do
    if [ -f "${PROJECT_ROOT}/src/__tests__/${BASENAME}.test.${EXT}" ]; then return 1; fi
  done

  # 같은 apply_patch 안에서 소스와 함께 추가되는 테스트 파일도 인정한다.
  # (PreToolUse 시점엔 아직 디스크에 없으므로 패치의 대상 목록 FILES 를 확인)
  local OTHER OB
  while IFS= read -r OTHER; do
    [ -z "$OTHER" ] && continue
    OB=$(basename "$OTHER")
    case "$OB" in
      "${BASENAME}.test."*|"${BASENAME}.spec."*) return 1 ;;
    esac
    case "$OTHER" in
      *"/__tests__/${BASENAME}.test."*) return 1 ;;
    esac
  done <<< "$FILES"

  return 0
}

while IFS= read -r F; do
  [ -z "$F" ] && continue
  if needs_test "$F"; then
    BN=$(basename "$F" | sed -E 's/\.(ts|tsx|js|jsx)$//')
    deny "TDD GUARD: '${BN}'에 대한 테스트 파일이 존재하지 않습니다. 구현 코드를 작성하기 전에 테스트를 먼저 작성하세요. (테스트 파일 예: ${BN}.test.ts)"
  fi
done <<< "$FILES"

exit 0
