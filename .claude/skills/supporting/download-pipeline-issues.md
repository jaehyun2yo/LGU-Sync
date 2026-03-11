# Download Pipeline Issue Catalog

86 issues found via code review. Team members MUST reference this catalog when working.

## CRITICAL (15)

### Security (SEC)
| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| SEC-1 | ConfigManager | `config-manager.ts:13-21` | Real credentials (LGU+ account, R2 keys, API keys) hardcoded in DEFAULT_CONFIG |
| SEC-2 | LGUplusClient | `lguplus-client.ts:54-55` | Password stored as plaintext in memory for instance lifetime |
| SEC-3 | LGUplusClient | `lguplus-client.ts:961-962` | certificationKey hardcoded (`'Hw9mJtbPPX57yV661Qlx'`) |
| SEC-4 | StateManager | `state-manager.ts:161` | SQL injection in getFilesByFolder sortBy/sortOrder (unbound params) |
| SEC-5 | StateManager | `state-manager.ts:205-224` | updateFolder dynamic column name without allowlist (SQL injection) |

### Data Integrity (DATA)
| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| DATA-1 | LGUplusClient | `lguplus-client.ts:443-446` | Empty API response treated as success (RESULT_CODE '0000') -> missed file detection |
| DATA-2 | YjlaserUploader | `yjlaser-uploader.ts:208-299` | R2 PUT success + batch-record failure = orphan objects (no compensating txn) |

### Concurrency (CONC)
| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| CONC-1 | SyncEngine | `sync-engine.ts:59-75` | start() duplicate call registers onFilesDetected handler twice |
| CONC-2 | SyncEngine | `sync-engine.ts:77-103` | stop() order error: detectionUnsubscribe->detector.stop() -> event loss |
| CONC-3 | SyncEngine | `sync-engine.ts:220-228` | scanFolder worker pool bypasses global maxConcurrent (x2 concurrent) |

### DLQ Infrastructure (DLQ)
| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| DLQ-1 | RetryManager | `retry-manager.ts:159-160` | retryAllDlq() doesn't check success -> deletes failed items from DLQ |
| DLQ-2 | RetryManager | `retry-manager.ts:158` | DLQ retry with file_id=null uses file_name for syncFile -> always fails |
| DLQ-3 | SyncEngine | `sync-engine.ts:454-466` | retryAllDlq file_id/file_name confusion bug |

### Circuit Breaker (CB)
| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| CB-1 | RetryManager | `retry-manager.ts:55-61` | HALF_OPEN probeInFlight set after second probe entry possible (state oscillation) |

## MAJOR (33)

### Security (SEC)
| ID | File:Line | Issue |
|----|-----------|-------|
| SEC-6 | `lguplus-client.ts:200-204` | formFields logging exposes password key |
| SEC-7 | `config-manager.ts:134-136` | reset() restores hardcoded credentials |
| SEC-8 | `container.ts:83-85` | useMockUploader unset -> direct production API connection |

### Concurrency/State (CONC)
| ID | File:Line | Issue |
|----|-----------|-------|
| CONC-4 | `file-detector.ts:214-231` | Backoff recovery stop()->start() recursion -> concurrent polls |
| CONC-5 | `file-detector.ts:99` | isPolling no lock -> interval+forceCheck concurrent execution |
| CONC-6 | `sync-engine.ts:59-75` | stopped->syncing direct transition (bypasses idle) |
| CONC-7 | `lguplus-client.ts:776-781` | getAllFilesDeep worker pool completion detection race condition |

### Error Handling (ERR)
| ID | File:Line | Issue |
|----|-----------|-------|
| ERR-1 | `lguplus-client.ts:529-536` | redirect:'follow' default misses session-expired 302 |
| ERR-2 | `lguplus-client.ts:539-545` | handleSessionExpiry can recurse |
| ERR-3 | `state-manager.ts:53-59` | Migration errors fully swallowed (should only ignore duplicate column) |
| ERR-4 | `state-manager.ts:38-62` | initialize() failure leaves db unguarded -> TypeError on subsequent calls |
| ERR-5 | `state-manager.ts:42-45` | Unsafe PRAGMA parsing -> foreign_keys may be missing |

### Data Integrity (DATA)
| ID | File:Line | Issue |
|----|-----------|-------|
| DATA-3 | `sync-engine.ts:563-569` | handleFileRename new_path always equals old_path |
| DATA-4 | `sync-engine.ts:259-269` | lguplusFileId===0 not treated as valid ID |
| DATA-5 | `sync-engine.ts:193-200` | forceRescan can't reprocess dl_failed/ul_failed files |
| DATA-6 | `state-manager.ts:92-113` | saveFile + logEvent non-atomic (no transaction) |
| DATA-7 | `state-manager.ts:120-131` | allowedFields missing oper_code |
| DATA-8 | `lguplus-client.ts:691` | getAllFiles page size miscalculation (post-filter size) |
| DATA-9 | `sync-engine.ts:212` | fullSync lguplus file ID source unclear (itemId vs itemSrcNo) |
| DATA-10 | `file-detector.ts:104-112` | Baseline set from page 1 only for global max |
| DATA-11 | `file-detector.ts:83` | Guest (client) uploads in history unverified (core assumption) |

### DLQ/Retry (DLQ)
| ID | File:Line | Issue |
|----|-----------|-------|
| DLQ-4 | `sync-engine.ts:306-315` | No addToDlq() call site -> DLQ auto-transition missing |
| DLQ-5 | `retry-manager.ts:138-141` | getDlqItems() always returns empty array (dead method) |
| DLQ-6 | `retry-manager.ts:143-145` | retryDlqItem() empty implementation (stub) |
| DLQ-7 | `retry-manager.ts:80-90` | Non-retryable AUTH/CONFIG errors count toward circuit failureCount |

### Uploader (UPL)
| ID | File:Line | Issue |
|----|-----------|-------|
| UPL-1 | `yjlaser-uploader.ts:26,183-205` | folderPathCache infinite (no TTL) -> cache pollution |
| UPL-2 | `yjlaser-uploader.ts:225-235` | presignRes.data null check missing |
| UPL-3 | `yjlaser-uploader.ts:309` | uploadFileBatch skipped counter always 0 (const) |
| UPL-4 | `yjlaser-uploader.ts:208` | uploadFile doesn't use RetryManager -> bypasses circuit breaker |
| UPL-5 | `yjlaser-uploader.ts:192-200` | ensureFolderPath doesn't distinguish network error from "folder missing" |
| UPL-6 | `yjlaser-uploader.ts:97-118` | testConnection optimistically sets _connected (true even on 401) |

### Performance (PERF)
| ID | File:Line | Issue |
|----|-----------|-------|
| PERF-1 | `sync-engine.ts:354-366` | getFolder() double call = duplicate DB query |
| PERF-2 | `lguplus-client.ts:1043-1047` | ws.end() before finish event handler registration |
| PERF-3 | `lguplus-client.ts:514-524` | Charset-less responses: double arrayBuffer decoding |

### Unimplemented (IMPL)
| ID | File:Line | Issue |
|----|-----------|-------|
| IMPL-1 | `webhard-uploader.types.ts:71-79` | IWebhardUploader 6 methods unimplemented (deleteFile, moveFile, etc.) |
| IMPL-2 | `lguplus-client.ts:931` | Download URL fallback hardcoded |
| IMPL-3 | `lguplus-client.ts:674` | getFileList folder item detection uses unreliable heuristic |

## MINOR (38) — Summary

| Category | Count | Representative |
|----------|-------|---------------|
| EventBus handlers | 4 | emit exception propagation, on() no unsubscribe, off duplicate, handler memory leak |
| FileDetector | 4 | Unknown operCode silent fallback, fileSize=0, MAX_POLL_PAGES hardcoded, polling error not emitted |
| Path handling | 3 | filePath trailing slash, path traversal (..), Windows/Unix separator mixing |
| DB/Schema | 5 | SCHEMA_VERSION not in DB, boolean column conversion, getLogs/getLogCount duplication, folder_changes NOT NULL, SyncEventInsertSchema missing oper_code |
| Config/Hardcoding | 4 | Multiple hardcoded values, LGU+ baseURL, maxConcurrent immutable, validate() no error return |
| Error classification | 3 | Circuit OPEN throws plain Error, AuthLoginFailedError retryable=true, DLQ next_retry_at unused |
| Uploader | 3 | Checksum unused, authHeaders Content-Type fixed, Logger forward reference |
| Other | 3 | fileSize=0 integrity, NaN fileId, SyncEngine.syncFile external call no graceful shutdown |
| UI | 3 | Upload progress 50% hardcoded, stopping state not reflected, offset:0 falsy comparison |

## Issue Dependency Groups

| Group | Issues | Reason |
|-------|--------|--------|
| DLQ Infrastructure | DLQ-1~6 | Entire DLQ is non-functional, partial fixes are meaningless |
| Security Credentials | SEC-1~3, SEC-7~8 | Credential management needs full refactor |
| SQL Injection | SEC-4~5 | Same pattern (missing allowlist), batch fix |
| Concurrency Control | CONC-1~5 | Polling/sync race conditions cascade |
| State Consistency | DATA-3~7 | DB state vs actual flow mismatches |
