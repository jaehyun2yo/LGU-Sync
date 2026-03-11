# Changelog

## [Unreleased]

### Added
- 실시간 감지 페이지 (백그라운드/다운타임 복구)
- 스캔 진행바, 디렉토리 트리 표시
- 통합 알림 시스템 (토스트 + Web Audio 알림음)
- 서킷 브레이커 상태 UI 노출 + 수동 리셋
- 다운로드/감지 전담 팀 스킬 (멀티에이전트)
- 작업 문서 자동 리마인드 훅

### Fixed
- 깊은 폴더 스캔 누락 (ITEM_ID → ITEM_SRC_NO)
- 다운로드 파이프라인 서킷 브레이커 수정
- 다운로드 중복 체크 버그
- LGU+ 파일 ID 누락 방어 코드
- 파일 확장자 중복 방지 (toDetectedFile)
- LGU+ API 한글 인코딩 수정

### Changed
- 핵심 서비스 전면 리팩토링 및 성능 최적화
- polling 단일화 및 snapshot 전략 폐기
- 대용량 파일 스트리밍 전환, 배치 병렬화

## [1.0.0] - 2026-02-24

### Added
- LGU+ 외부웹하드 폴링 기반 파일 감지
- 파일 다운로드 파이프라인 (LGUplusClient)
- 자체웹하드 업로드 (YjlaserUploader)
- SQLite 기반 동기화 상태 관리
- Electron GUI (React 19 + Zustand + Tailwind CSS v4)
- DI 컨테이너 기반 서비스 아키텍처
- IPC 타입 안전 통신 패턴
