import type { ILogger, LogLevel, LogContext } from './types/logger.types'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface LogEntry {
  level: LogLevel
  message: string
  context: LogContext
  timestamp: string
}

export interface LoggerOptions {
  minLevel?: LogLevel
  onLog?: (entry: LogEntry) => void
  context?: LogContext
}

export class Logger implements ILogger {
  private minLevel: number
  private onLog?: (entry: LogEntry) => void
  private baseContext: LogContext

  constructor(options?: LoggerOptions) {
    this.minLevel = LEVEL_ORDER[options?.minLevel ?? 'debug']
    this.onLog = options?.onLog
    this.baseContext = options?.context ?? {}
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, undefined, context)
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, undefined, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, undefined, context)
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log('error', message, error, context)
  }

  child(context: LogContext): ILogger {
    return new Logger({
      minLevel: (Object.entries(LEVEL_ORDER).find(([, v]) => v === this.minLevel)?.[0] ??
        'debug') as LogLevel,
      onLog: this.onLog,
      context: { ...this.baseContext, ...context },
    })
  }

  private log(level: LogLevel, message: string, error?: Error, context?: LogContext): void {
    if (LEVEL_ORDER[level] < this.minLevel) return

    const merged: LogContext = {
      ...this.baseContext,
      ...context,
      ...(error ? { error: error.message, stack: error.stack } : {}),
    }

    const timestamp = new Date().toISOString()
    const tag = `[${level.toUpperCase()}]`

    if (this.onLog) {
      this.onLog({ level, message, context: merged, timestamp })
    }

    const hasContext = Object.keys(merged).length > 0

    switch (level) {
      case 'debug':
      case 'info':
        if (hasContext) {
          console.log(tag, message, merged)
        } else {
          console.log(tag, message)
        }
        break
      case 'warn':
        if (hasContext) {
          console.warn(tag, message, merged)
        } else {
          console.warn(tag, message)
        }
        break
      case 'error':
        if (hasContext) {
          console.error(tag, message, merged)
        } else {
          console.error(tag, message)
        }
        break
    }
  }
}
