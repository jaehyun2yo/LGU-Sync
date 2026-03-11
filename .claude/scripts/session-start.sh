#!/bin/bash
# SessionStart hook: output current progress for context injection
PROGRESS_FILE="docs/progress.txt"
if [ -f "$PROGRESS_FILE" ]; then
  echo "=== 현재 진행 상황 ==="
  cat "$PROGRESS_FILE"
  echo ""
  echo "=== 최근 커밋 ==="
  git log --oneline -5 2>/dev/null
else
  echo "[WARN] docs/progress.txt 파일이 없습니다. 세션 프로토콜에 따라 생성하세요."
fi
