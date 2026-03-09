// src/core/errors/index.ts — [SPEC] Error hierarchy and classification
// SDD Level 1: Error type contracts

export type ErrorCategory = 'NETWORK' | 'AUTH' | 'API' | 'FILE' | 'DB' | 'CONFIG' | 'INTERNAL'

export abstract class SyncAppError extends Error {
  abstract readonly code: string
  abstract readonly category: ErrorCategory
  abstract readonly retryable: boolean
  readonly timestamp = Date.now()
  readonly context: Record<string, unknown>

  constructor(message: string, context?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, options)
    this.name = this.constructor.name
    this.context = context ?? {}
  }
}

// ── Network Errors ──

export class NetworkTimeoutError extends SyncAppError {
  readonly code = 'NET_TIMEOUT'
  readonly category = 'NETWORK' as const
  readonly retryable = true
}

export class NetworkConnectionError extends SyncAppError {
  readonly code = 'NET_CONNECTION_REFUSED'
  readonly category = 'NETWORK' as const
  readonly retryable = true
}

export class NetworkLGUplusDownError extends SyncAppError {
  readonly code = 'NET_LGUPLUS_DOWN'
  readonly category = 'NETWORK' as const
  readonly retryable = true
}

export class NetworkWebhardDownError extends SyncAppError {
  readonly code = 'NET_WEBHARD_DOWN'
  readonly category = 'NETWORK' as const
  readonly retryable = true
}

// ── Auth Errors ──

export class AuthLoginFailedError extends SyncAppError {
  readonly code = 'AUTH_LOGIN_FAILED'
  readonly category = 'AUTH' as const
  readonly retryable = true
}

export class AuthSessionExpiredError extends SyncAppError {
  readonly code = 'AUTH_SESSION_EXPIRED'
  readonly category = 'AUTH' as const
  readonly retryable = true
}

export class AuthCaptchaRequiredError extends SyncAppError {
  readonly code = 'AUTH_CAPTCHA_REQUIRED'
  readonly category = 'AUTH' as const
  readonly retryable = false
}

export class AuthInvalidCredentialsError extends SyncAppError {
  readonly code = 'AUTH_INVALID_CREDENTIALS'
  readonly category = 'AUTH' as const
  readonly retryable = false
}

export class AuthWebhardKeyInvalidError extends SyncAppError {
  readonly code = 'AUTH_WEBHARD_KEY_INVALID'
  readonly category = 'AUTH' as const
  readonly retryable = false
}

// ── API Errors ──

export class ApiResponseParseError extends SyncAppError {
  readonly code = 'API_RESPONSE_PARSE'
  readonly category = 'API' as const
  readonly retryable = false
}

export class ApiUnexpectedResponseError extends SyncAppError {
  readonly code = 'API_UNEXPECTED_RESPONSE'
  readonly category = 'API' as const
  readonly retryable = true
}

// ── File / Download / Upload Errors ──

export class FileDownloadUrlFetchError extends SyncAppError {
  readonly code = 'DL_URL_FETCH_FAILED'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class FileDownloadNotFoundError extends SyncAppError {
  readonly code = 'DL_FILE_NOT_FOUND'
  readonly category = 'FILE' as const
  readonly retryable = false
}

export class FileDownloadTransferError extends SyncAppError {
  readonly code = 'DL_TRANSFER_FAILED'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class FileDownloadSizeMismatchError extends SyncAppError {
  readonly code = 'DL_SIZE_MISMATCH'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class FileDownloadCircuitOpenError extends SyncAppError {
  readonly code = 'DL_CIRCUIT_OPEN'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class FileUploadError extends SyncAppError {
  readonly code = 'UL_TRANSFER_FAILED'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class FileUploadFolderCreateError extends SyncAppError {
  readonly code = 'UL_FOLDER_CREATE_FAILED'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class FileChecksumMismatchError extends SyncAppError {
  readonly code = 'UL_CHECKSUM_MISMATCH'
  readonly category = 'FILE' as const
  readonly retryable = true
}

export class DiskSpaceError extends SyncAppError {
  readonly code = 'FS_DISK_FULL'
  readonly category = 'FILE' as const
  readonly retryable = false
}

export class FilePermissionError extends SyncAppError {
  readonly code = 'FS_PERMISSION_DENIED'
  readonly category = 'FILE' as const
  readonly retryable = false
}

export class FileWriteError extends SyncAppError {
  readonly code = 'FS_WRITE_FAILED'
  readonly category = 'FILE' as const
  readonly retryable = true
}

// ── Sync Errors ──

export class SyncPollingFailedError extends SyncAppError {
  readonly code = 'SYNC_POLLING_FAILED'
  readonly category = 'INTERNAL' as const
  readonly retryable = true
}

export class SyncCheckpointLostError extends SyncAppError {
  readonly code = 'SYNC_CHECKPOINT_LOST'
  readonly category = 'INTERNAL' as const
  readonly retryable = false
}

export class SyncQueueOverflowError extends SyncAppError {
  readonly code = 'SYNC_QUEUE_OVERFLOW'
  readonly category = 'INTERNAL' as const
  readonly retryable = true
}

export class SyncHistoryGapError extends SyncAppError {
  readonly code = 'SYNC_HISTORY_GAP'
  readonly category = 'INTERNAL' as const
  readonly retryable = true
}

// ── DB Errors ──

export class DatabaseCorruptedError extends SyncAppError {
  readonly code = 'DB_CORRUPTED'
  readonly category = 'DB' as const
  readonly retryable = false
}

export class DatabaseLockedError extends SyncAppError {
  readonly code = 'DB_LOCKED'
  readonly category = 'DB' as const
  readonly retryable = true
}

// ── Config Errors ──

export class ConfigValidationError extends SyncAppError {
  readonly code = 'CONFIG_VALIDATION'
  readonly category = 'CONFIG' as const
  readonly retryable = false
}

// ── IPC Errors ──

export class IpcHandlerNotFoundError extends SyncAppError {
  readonly code = 'IPC_HANDLER_NOT_FOUND'
  readonly category = 'INTERNAL' as const
  readonly retryable = false
}

export class IpcTimeoutError extends SyncAppError {
  readonly code = 'IPC_TIMEOUT'
  readonly category = 'INTERNAL' as const
  readonly retryable = true
}
