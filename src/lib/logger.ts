/**
 * Centralized logging utility
 * Replaces console.log/error/warn with structured logging
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogContext {
  [key: string]: any;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private logLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (!this.shouldLog('error')) return;

    const errorContext: LogContext = {
      ...context,
      ...(error instanceof Error
        ? {
            error: error.message,
            stack: error.stack,
            name: error.name,
          }
        : error
        ? { error: String(error) }
        : {}),
    };

    if (this.isDevelopment) {
      console.error(this.formatMessage('error', message, errorContext));
    } else {
      // In production, you could send to logging service
      console.error(this.formatMessage('error', message, errorContext));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;

    if (this.isDevelopment) {
      console.warn(this.formatMessage('warn', message, context));
    } else {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;

    if (this.isDevelopment) {
      console.log(this.formatMessage('info', message, context));
    } else {
      // In production, only log important info
      console.log(this.formatMessage('info', message, context));
    }
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;

    if (this.isDevelopment) {
      console.debug(this.formatMessage('debug', message, context));
    }
    // Don't log debug in production
  }
}

export const logger = new Logger();







