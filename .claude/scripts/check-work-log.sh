#!/bin/bash
# PostToolUse hook: git commit 후 작업 문서 작성 리마인드
# Exit 0 = pass, Exit 2 = feedback to Claude (stderr)

TOOL_INPUT=$(cat)

# git commit 명령이 아니면 패스
if ! echo "$TOOL_INPUT" | grep -q 'git commit'; then
  exit 0
fi

# 작업 문서 관련 커밋이면 패스
if echo "$TOOL_INPUT" | grep -qi 'work-log\|work_log\|docs/work-logs'; then
  exit 0
fi

# docs: 접두사 커밋이면 패스
if echo "$TOOL_INPUT" | grep -q '"docs:'; then
  exit 0
fi

# git add만 하는 명령이면 패스 (커밋 아님)
if ! echo "$TOOL_INPUT" | grep -q 'git commit'; then
  exit 0
fi

# 다음 작업 문서 번호 계산
LAST_LOG=$(ls docs/work-logs/*.md 2>/dev/null | sort | tail -1)
LAST_NUM=0
if [ -n "$LAST_LOG" ]; then
  LAST_NUM=$(basename "$LAST_LOG" | sed 's/^\([0-9]*\).*/\1/')
fi
NEXT_NUM=$(printf "%03d" $((10#${LAST_NUM:-0} + 1)))

cat >&2 <<REMINDER
[WORK-LOG-REMINDER] git commit이 감지되었습니다.
기능 수정/개발 작업이라면 docs/work-logs/${NEXT_NUM}-작업명.md 작업 문서를 반드시 작성하세요.
단순 설정 변경, 포맷팅, 의존성 업데이트 등은 작업 문서가 필요하지 않습니다.
REMINDER

exit 2
