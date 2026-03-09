# 009. 작업문서 자동 리마인드 Hook 설정

- **날짜:** 2026-03-09
- **브랜치:** master

## 변경 요약
Claude Code의 PostToolUse hook을 활용하여, git commit 실행 시 작업 문서(`docs/work-logs/`) 작성을 자동으로 리마인드하는 기능 추가.

## 변경 파일
- `.claude/settings.json` — PostToolUse hook 설정 (Bash 도구의 git commit 감지)
- `.claude/scripts/check-work-log.sh` — 커밋 유형 판별 및 리마인드 스크립트

## 주요 결정사항
- `docs:` 접두사 커밋이나 `docs/work-logs/` 경로를 포함한 커밋은 자동 스킵하여 무한 리마인드 방지
- `jq` 미설치 환경 대응을 위해 `grep`/`sed`만으로 JSON 파싱
- exit code 2 + stderr로 Claude에게 피드백 전달 (Claude Code hook 규약)

## 검증
- 4개 시나리오 테스트 통과: 일반 커밋(리마인드 발생), docs: 커밋(패스), work-logs 경로(패스), 비-git 명령(패스)
