/**
 * Minimal typed logger that delegates to console.* with a consistent prefix.
 *
 * Usage:
 *   const log = new Logger('MuxerHandler');
 *   log.info('episode start:', { processId });
 *   log.error('failure:', err);
 *   log.warn('unexpected state');
 *   log.debug('reader close');
 */
export class Logger {
    readonly #prefix: string;

    constructor(prefix: string) {
        this.#prefix = prefix;
    }

    info(message: string, ...args: unknown[]): void {
        console.log(`[${this.#prefix}] ${message}`, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        console.warn(`[${this.#prefix}] ${message}`, ...args);
    }

    error(message: string, ...args: unknown[]): void {
        console.error(`[${this.#prefix}] ${message}`, ...args);
    }

    debug(message: string, ...args: unknown[]): void {
        console.debug(`[${this.#prefix}] ${message}`, ...args);
    }
}
