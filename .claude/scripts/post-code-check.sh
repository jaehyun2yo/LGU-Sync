#!/bin/bash
# PostToolUse hook for Edit/Write: quick typecheck on changed files
# Only runs typecheck (fast) - full pipeline is via /post-code command

# Get the file that was just edited from the tool input
# This script is triggered after Edit/Write tools
npm run typecheck 2>&1 | tail -20

EXIT_CODE=${PIPESTATUS[0]}
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "[!] TypeScript 타입 에러 발견. 수정이 필요합니다."
fi
exit 0
