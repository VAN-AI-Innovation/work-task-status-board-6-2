#!/usr/bin/env python3
"""
Harness Step Executor — phase 내 step을 순차 실행하고 자가 교정한다.

Usage:
    python3 scripts/execute.py <phase-dir> [--push]
"""

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import types
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent

# 구독(OAuth) 인증으로만 돌리기 위해 자식 프로세스에서 제거하는 환경변수.
# 이 값이 남아 있으면 claude CLI가 종량 과금 경로(API 키 · Bedrock · Vertex)로 붙는다.
BILLED_AUTH_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
)


@contextlib.contextmanager
def progress_indicator(label: str):
    """터미널 진행 표시기. with 문으로 사용하며 .elapsed 로 경과 시간을 읽는다."""
    frames = "◐◓◑◒"
    stop = threading.Event()
    t0 = time.monotonic()

    def _animate():
        idx = 0
        while not stop.wait(0.12):
            sec = int(time.monotonic() - t0)
            sys.stderr.write(f"\r{frames[idx % len(frames)]} {label} [{sec}s]")
            sys.stderr.flush()
            idx += 1
        sys.stderr.write("\r" + " " * (len(label) + 20) + "\r")
        sys.stderr.flush()

    th = threading.Thread(target=_animate, daemon=True)
    th.start()
    info = types.SimpleNamespace(elapsed=0.0)
    try:
        yield info
    finally:
        stop.set()
        th.join()
        info.elapsed = time.monotonic() - t0


class StepExecutor:
    """Phase 디렉토리 안의 step들을 순차 실행하는 하네스."""

    MAX_RETRIES = 3
    TZ = timezone(timedelta(hours=9))

    # step 하나에 허용하는 최대 시간(초). 저장소 계약 테스트처럼 네트워크를 타는 step은
    # 30분을 넘긴다 (T4 step 9 실측).
    STEP_TIMEOUT = 3600

    # step이 completed를 적어도 그대로 믿지 않고 직접 돌려보는 게이트.
    GATE_CMD = "npm run lint && npm run build && npm run test"

    # 커밋 메시지 컨벤션 `{type}: {설명}` (docs/TEAM_RULES.md 3.3).
    # scope 괄호(`feat(ui):`)는 Conventional Commits 형식이라 허용하지 않는다.
    COMMIT_RE = re.compile(r"^(feat|fix|docs|style|refactor|test|chore): \S.*$")
    META_MSG = "chore: {phase} step {num} 진행 상태 갱신"
    DONE_MSG = "chore: {phase} 단계 완료 표시"

    def __init__(self, phase_dir_name: str):
        self._root = str(ROOT)
        self._phases_dir = ROOT / "phases"
        self._phase_dir = self._phases_dir / phase_dir_name
        self._phase_dir_name = phase_dir_name
        self._top_index_file = self._phases_dir / "index.json"

        if not self._phase_dir.is_dir():
            print(f"ERROR: {self._phase_dir} not found")
            sys.exit(1)

        self._index_file = self._phase_dir / "index.json"
        if not self._index_file.exists():
            print(f"ERROR: {self._index_file} not found")
            sys.exit(1)

        idx = self._read_json(self._index_file)
        self._project = idx.get("project", "project")
        self._phase_name = idx.get("phase", phase_dir_name)
        self._total = len(idx["steps"])
        self._validate_commit_messages(idx["steps"])

    def _validate_commit_messages(self, steps: list):
        """모든 step이 컨벤션에 맞는 커밋 제목을 갖고 있는지 실행 전에 확인한다.

        실행 도중 발견하면 이미 규칙을 어긴 커밋이 쌓인 뒤라 되돌리기 어렵다.
        """
        bad = [s for s in steps if not self.COMMIT_RE.match(s.get("commit", ""))]
        if not bad:
            return
        print(f"ERROR: step의 'commit' 제목이 컨벤션에 맞지 않습니다 (docs/TEAM_RULES.md 3.3).")
        print(f"  형식: {{type}}: {{설명}}  —  type은 feat|fix|docs|style|refactor|test|chore")
        for s in bad:
            print(f"  step {s.get('step')} ({s.get('name')}): {s.get('commit', '<없음>')!r}")
        sys.exit(1)

    def run(self):
        self._print_header()
        self._check_blockers()
        self._assert_not_main()
        guardrails = self._load_guardrails()
        self._ensure_created_at()
        self._execute_all_steps(guardrails)
        self._finalize()

    # --- timestamps ---

    def _stamp(self) -> str:
        return datetime.now(self.TZ).strftime("%Y-%m-%dT%H:%M:%S%z")

    # --- JSON I/O ---

    @staticmethod
    def _read_json(p: Path) -> dict:
        return json.loads(p.read_text(encoding="utf-8"))

    @staticmethod
    def _write_json(p: Path, data: dict):
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # --- git ---

    def _run_git(self, *args) -> subprocess.CompletedProcess:
        cmd = ["git"] + list(args)
        return subprocess.run(cmd, cwd=self._root, capture_output=True, text=True)

    def _assert_not_main(self):
        """현재 브랜치가 main/master가 아닌지만 확인한다.

        브랜치 생성·전환은 하지 않는다. 팀 규칙의 브랜치명은 `type/#이슈번호`
        (docs/TEAM_RULES.md 2.1)라서 phase 이름으로 추론할 수 없다.
        """
        r = self._run_git("rev-parse", "--abbrev-ref", "HEAD")
        if r.returncode != 0:
            print(f"  ERROR: git을 사용할 수 없거나 git repo가 아닙니다.")
            print(f"  {r.stderr.strip()}")
            sys.exit(1)

        branch = r.stdout.strip()
        if branch in ("main", "master"):
            print(f"  ERROR: '{branch}'에서는 실행할 수 없습니다. 하네스는 커밋을 만듭니다.")
            print(f"  Hint: 이슈 번호로 브랜치를 먼저 만드세요 — git checkout -b 'chore/#3'")
            sys.exit(1)

        print(f"  Branch: {branch}")

    def _commit_step(self, step: dict):
        step_num = step["step"]
        output_rel = f"phases/{self._phase_dir_name}/step{step_num}-output.json"
        index_rel = f"phases/{self._phase_dir_name}/index.json"

        self._run_git("add", "-A")
        self._run_git("reset", "HEAD", "--", output_rel)
        self._run_git("reset", "HEAD", "--", index_rel)

        if self._run_git("diff", "--cached", "--quiet").returncode != 0:
            msg = step["commit"]
            r = self._run_git("commit", "-m", msg)
            if r.returncode == 0:
                print(f"  Commit: {msg}")
            else:
                print(f"  WARN: 코드 커밋 실패: {r.stderr.strip()}")

        self._run_git("add", "-A")
        if self._run_git("diff", "--cached", "--quiet").returncode != 0:
            msg = self.META_MSG.format(phase=self._phase_name, num=step_num)
            r = self._run_git("commit", "-m", msg)
            if r.returncode != 0:
                print(f"  WARN: 메타데이터 커밋 실패: {r.stderr.strip()}")

    # --- top-level index ---

    def _update_top_index(self, status: str):
        if not self._top_index_file.exists():
            return
        top = self._read_json(self._top_index_file)
        ts = self._stamp()
        for phase in top.get("phases", []):
            if phase.get("dir") == self._phase_dir_name:
                phase["status"] = status
                ts_key = {"completed": "completed_at", "error": "failed_at", "blocked": "blocked_at"}.get(status)
                if ts_key:
                    phase[ts_key] = ts
                break
        self._write_json(self._top_index_file, top)

    # --- guardrails & context ---

    def _load_guardrails(self) -> str:
        sections = []
        claude_md = ROOT / "CLAUDE.md"
        if claude_md.exists():
            sections.append(f"## 프로젝트 규칙 (CLAUDE.md)\n\n{claude_md.read_text()}")
        docs_dir = ROOT / "docs"
        if docs_dir.is_dir():
            for doc in sorted(docs_dir.glob("*.md")):
                sections.append(f"## {doc.stem}\n\n{doc.read_text()}")
        return "\n\n---\n\n".join(sections) if sections else ""

    @staticmethod
    def _build_step_context(index: dict) -> str:
        lines = [
            f"- Step {s['step']} ({s['name']}): {s['summary']}"
            for s in index["steps"]
            if s["status"] == "completed" and s.get("summary")
        ]
        if not lines:
            return ""
        return "## 이전 Step 산출물\n\n" + "\n".join(lines) + "\n\n"

    def _build_preamble(self, guardrails: str, step_context: str, commit_msg: str,
                        prev_error: Optional[str] = None) -> str:
        retry_section = ""
        if prev_error:
            retry_section = (
                f"\n## ⚠ 이전 시도 실패 — 아래 에러를 반드시 참고하여 수정하라\n\n"
                f"{prev_error}\n\n---\n\n"
            )
        return (
            f"당신은 {self._project} 프로젝트의 개발자입니다. 아래 step을 수행하세요.\n\n"
            f"{guardrails}\n\n---\n\n"
            f"{step_context}{retry_section}"
            f"## 작업 규칙\n\n"
            f"1. 이전 step에서 작성된 코드를 확인하고 일관성을 유지하라.\n"
            f"2. 이 step에 명시된 작업만 수행하라. 추가 기능이나 파일을 만들지 마라.\n"
            f"3. 기존 테스트를 깨뜨리지 마라.\n"
            f"4. AC(Acceptance Criteria) 검증을 직접 실행하라.\n"
            f"5. /phases/{self._phase_dir_name}/index.json의 해당 step status를 업데이트하라:\n"
            f"   - AC 통과 → \"completed\" + \"summary\" 필드에 이 step의 산출물을 한 줄로 요약\n"
            f"   - {self.MAX_RETRIES}회 수정 시도 후에도 실패 → \"error\" + \"error_message\" 기록\n"
            f"   - 사용자 개입이 필요한 경우 (API 키, 인증, 수동 설정 등) → \"blocked\" + \"blocked_reason\" 기록 후 즉시 중단\n"
            f"6. 커밋은 하네스가 한다. 직접 `git commit`을 실행하지 마라.\n"
            f"   이 step의 커밋 제목은 다음으로 확정돼 있다: {commit_msg}\n\n---\n\n"
        )

    # --- Claude 호출 ---

    @staticmethod
    def _subscription_env() -> dict:
        """구독 인증(OAuth)으로만 붙도록 종량 과금 환경변수를 걷어낸 env."""
        env = os.environ.copy()
        for key in BILLED_AUTH_ENV:
            env.pop(key, None)
        return env

    def _invoke_claude(self, step: dict, preamble: str) -> dict:
        step_num, step_name = step["step"], step["name"]
        step_file = self._phase_dir / f"step{step_num}.md"

        if not step_file.exists():
            print(f"  ERROR: {step_file} not found")
            sys.exit(1)

        # 프롬프트는 stdin으로 넣는다 — 가드레일(docs 전량)이 붙어 수십 KB가 되므로
        # argv에 실으면 길이 제한에 걸릴 수 있다.
        prompt = preamble + step_file.read_text()
        timed_out = False
        try:
            result = subprocess.run(
                ["claude", "-p", "--permission-mode", "bypassPermissions", "--output-format", "json"],
                cwd=self._root, capture_output=True, text=True, timeout=self.STEP_TIMEOUT,
                input=prompt, env=self._subscription_env(),
            )
        except subprocess.TimeoutExpired as exc:
            # 예외를 그대로 올리면 하네스가 죽고 그 step의 작업이 커밋되지 않은 채 남는다.
            # 실패한 시도로 바꿔 재시도 경로를 타게 한다.
            timed_out = True
            result = subprocess.CompletedProcess(
                exc.cmd, returncode=-1,
                stdout=(exc.stdout or b"").decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or ""),
                stderr=f"TIMEOUT: {self.STEP_TIMEOUT}초를 넘겨 중단됨",
            )
            print(f"\n  WARN: Step {step_num}이 {self.STEP_TIMEOUT}초를 넘겨 중단됐습니다.")

        if result.returncode != 0:
            print(f"\n  WARN: Claude가 비정상 종료됨 (code {result.returncode})")
            if result.stderr:
                print(f"  stderr: {result.stderr[:500]}")

        output = {
            "step": step_num, "name": step_name,
            "exitCode": result.returncode,
            "timedOut": timed_out,
            "stdout": result.stdout, "stderr": result.stderr,
        }
        out_path = self._phase_dir / f"step{step_num}-output.json"
        with open(out_path, "w") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        return output

    def _run_gate(self) -> tuple[bool, str]:
        """lint·build·test를 직접 돌린다.

        step 세션이 index.json에 completed를 적어도 그대로 믿지 않는다 — T4 step 9에서
        계약 테스트 10건이 깨진 채로 completed가 적힌 일이 실제로 있었다. 깨진 코드를
        커밋하면 다음 step이 그 위에 쌓여 되돌리기가 비싸진다.
        """
        r = subprocess.run(
            self.GATE_CMD, shell=True, cwd=self._root,
            capture_output=True, text=True, timeout=self.STEP_TIMEOUT,
        )
        if r.returncode == 0:
            return True, ""
        tail = (r.stdout or "")[-1500:] + (r.stderr or "")[-1500:]
        return False, f"게이트 실패 (lint/build/test): {tail}"

    # --- 헤더 & 검증 ---

    def _print_header(self):
        print(f"\n{'='*60}")
        print(f"  Harness Step Executor")
        print(f"  Phase: {self._phase_name} | Steps: {self._total}")
        print(f"{'='*60}")

    def _check_blockers(self):
        index = self._read_json(self._index_file)
        for s in reversed(index["steps"]):
            if s["status"] == "error":
                print(f"\n  ✗ Step {s['step']} ({s['name']}) failed.")
                print(f"  Error: {s.get('error_message', 'unknown')}")
                print(f"  Fix and reset status to 'pending' to retry.")
                sys.exit(1)
            if s["status"] == "blocked":
                print(f"\n  ⏸ Step {s['step']} ({s['name']}) blocked.")
                print(f"  Reason: {s.get('blocked_reason', 'unknown')}")
                print(f"  Resolve and reset status to 'pending' to retry.")
                sys.exit(2)
            if s["status"] != "pending":
                break

    def _ensure_created_at(self):
        index = self._read_json(self._index_file)
        if "created_at" not in index:
            index["created_at"] = self._stamp()
            self._write_json(self._index_file, index)

    # --- 실행 루프 ---

    def _execute_single_step(self, step: dict, guardrails: str) -> bool:
        """단일 step 실행 (재시도 포함). 완료되면 True, 실패/차단이면 False."""
        step_num, step_name = step["step"], step["name"]
        done = sum(1 for s in self._read_json(self._index_file)["steps"] if s["status"] == "completed")
        prev_error = None

        for attempt in range(1, self.MAX_RETRIES + 1):
            index = self._read_json(self._index_file)
            step_context = self._build_step_context(index)
            preamble = self._build_preamble(guardrails, step_context, step["commit"], prev_error)

            tag = f"Step {step_num}/{self._total - 1} ({done} done): {step_name}"
            if attempt > 1:
                tag += f" [retry {attempt}/{self.MAX_RETRIES}]"

            with progress_indicator(tag) as pi:
                invocation = self._invoke_claude(step, preamble)
                elapsed = int(pi.elapsed)
            timed_out = bool(invocation.get("timedOut"))

            index = self._read_json(self._index_file)
            status = next((s.get("status", "pending") for s in index["steps"] if s["step"] == step_num), "pending")
            ts = self._stamp()

            if status == "completed" and timed_out:
                # 시간 초과로 잘린 세션의 completed 선언은 근거가 없다.
                status = "pending"
                gate_error = f"세션이 {self.STEP_TIMEOUT}초를 넘겨 중단됐다. completed 표시를 신뢰하지 않는다."
            elif status == "completed":
                ok, gate_error = self._run_gate()
                if not ok:
                    status = "pending"
                else:
                    for s in index["steps"]:
                        if s["step"] == step_num:
                            s["completed_at"] = ts
                    self._write_json(self._index_file, index)
                    self._commit_step(step)
                    print(f"  ✓ Step {step_num}: {step_name} [{elapsed}s]")
                    return True
            else:
                gate_error = None

            if status == "blocked":
                for s in index["steps"]:
                    if s["step"] == step_num:
                        s["blocked_at"] = ts
                self._write_json(self._index_file, index)
                reason = next((s.get("blocked_reason", "") for s in index["steps"] if s["step"] == step_num), "")
                print(f"  ⏸ Step {step_num}: {step_name} blocked [{elapsed}s]")
                print(f"    Reason: {reason}")
                self._update_top_index("blocked")
                sys.exit(2)

            err_msg = gate_error or next(
                (s.get("error_message", "Step did not update status") for s in index["steps"] if s["step"] == step_num),
                "Step did not update status",
            )

            if attempt < self.MAX_RETRIES:
                for s in index["steps"]:
                    if s["step"] == step_num:
                        s["status"] = "pending"
                        s.pop("error_message", None)
                self._write_json(self._index_file, index)
                prev_error = err_msg
                print(f"  ↻ Step {step_num}: retry {attempt}/{self.MAX_RETRIES} — {err_msg}")
            else:
                for s in index["steps"]:
                    if s["step"] == step_num:
                        s["status"] = "error"
                        s["error_message"] = f"[{self.MAX_RETRIES}회 시도 후 실패] {err_msg}"
                        s["failed_at"] = ts
                self._write_json(self._index_file, index)
                self._commit_step(step)
                print(f"  ✗ Step {step_num}: {step_name} failed after {self.MAX_RETRIES} attempts [{elapsed}s]")
                print(f"    Error: {err_msg}")
                self._update_top_index("error")
                sys.exit(1)

        return False  # unreachable

    def _execute_all_steps(self, guardrails: str):
        while True:
            index = self._read_json(self._index_file)
            pending = next((s for s in index["steps"] if s["status"] == "pending"), None)
            if pending is None:
                print("\n  All steps completed!")
                return

            step_num = pending["step"]
            for s in index["steps"]:
                if s["step"] == step_num and "started_at" not in s:
                    s["started_at"] = self._stamp()
                    self._write_json(self._index_file, index)
                    break

            self._execute_single_step(pending, guardrails)

    def _finalize(self):
        index = self._read_json(self._index_file)
        index["completed_at"] = self._stamp()
        self._write_json(self._index_file, index)
        self._update_top_index("completed")

        self._run_git("add", "-A")
        if self._run_git("diff", "--cached", "--quiet").returncode != 0:
            msg = self.DONE_MSG.format(phase=self._phase_name)
            r = self._run_git("commit", "-m", msg)
            if r.returncode == 0:
                print(f"  ✓ {msg}")

        print(f"\n{'='*60}")
        print(f"  Phase '{self._phase_name}' completed!")
        print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Harness Step Executor")
    parser.add_argument("phase_dir", help="Phase directory name (e.g. 0-mvp)")
    args = parser.parse_args()

    StepExecutor(args.phase_dir).run()


if __name__ == "__main__":
    main()
