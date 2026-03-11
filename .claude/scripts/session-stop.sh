#!/bin/bash
# Stop hook: check if handoff was done, warn if not
echo "=== 세션 종료 점검 ==="

# Check if progress.txt was recently updated (within last 30 min)
PROGRESS_FILE="docs/progress.txt"
if [ -f "$PROGRESS_FILE" ]; then
  # Get file modification time vs now (in seconds)
  FILE_TIME=$(stat -c %Y "$PROGRESS_FILE" 2>/dev/null || stat -f %m "$PROGRESS_FILE" 2>/dev/null)
  NOW=$(date +%s)
  DIFF=$((NOW - FILE_TIME))
  if [ "$DIFF" -gt 1800 ]; then
    echo "[!] progress.txt가 30분 이상 업데이트되지 않음. /post-code 실행 필요."
  else
    echo "[OK] progress.txt 최근 업데이트됨."
  fi
else
  echo "[!] progress.txt 파일 없음!"
fi

# Check uncommitted changes
CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
if [ "$CHANGES" -gt 0 ]; then
  echo "[!] 커밋되지 않은 변경사항: ${CHANGES}개"
  git status --short 2>/dev/null
  echo ""
  echo "세션 종료 전 /post-code를 실행하여 품질 검사 + 인수인계를 완료하세요."
else
  echo "[OK] 모든 변경사항 커밋됨."
fi

# Check if code changed but specs not updated
CODE_CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -c '^src/' || echo 0)
PLAN_CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -c '^docs/plans/' || echo 0)
if [ "$CODE_CHANGED" -gt 0 ] && [ "$PLAN_CHANGED" -eq 0 ]; then
  echo "[!] Code changed but docs/plans/ specs not updated. Check if spec sync is needed."
fi

# Check work log
LAST_LOG=$(ls -1 docs/work-logs/*.md 2>/dev/null | tail -1)
if [ -n "$LAST_LOG" ]; then
  LOG_TIME=$(stat -c %Y "$LAST_LOG" 2>/dev/null || stat -f %m "$LAST_LOG" 2>/dev/null)
  LOG_DIFF=$((NOW - LOG_TIME))
  if [ "$LOG_DIFF" -gt 3600 ]; then
    echo "[!] 작업 로그가 1시간 이상 미작성. docs/work-logs/ 확인 필요."
  else
    echo "[OK] 작업 로그 최근 작성됨: $(basename $LAST_LOG)"
  fi
fi
