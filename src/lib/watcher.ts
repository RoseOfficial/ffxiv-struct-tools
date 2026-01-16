/**
 * File watcher for real-time YAML monitoring and auto-export
 * Uses chokidar for cross-platform file watching
 */

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { EventEmitter } from 'node:events';

export interface WatcherOptions {
  /** Debounce delay in milliseconds (default: 500ms) */
  debounce?: number;
  /** Whether to run on initial discovery (default: false) */
  runOnReady?: boolean;
  /** Glob patterns to ignore */
  ignored?: string[];
}

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  timestamp: Date;
}

/**
 * File watcher that emits debounced change events
 * Batches rapid changes to avoid redundant processing
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges = new Map<string, WatchEvent>();
  private options: Required<WatcherOptions>;
  private isReady = false;

  constructor(options: WatcherOptions = {}) {
    super();
    this.options = {
      debounce: options.debounce ?? 500,
      runOnReady: options.runOnReady ?? false,
      ignored: options.ignored ?? ['**/node_modules/**', '**/.git/**'],
    };
  }

  /**
   * Start watching the specified patterns
   */
  async start(patterns: string[]): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    this.watcher = chokidarWatch(patterns, {
      persistent: true,
      ignoreInitial: !this.options.runOnReady,
      ignored: this.options.ignored,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on('add', (path: string) => this.handleEvent('add', path))
      .on('change', (path: string) => this.handleEvent('change', path))
      .on('unlink', (path: string) => this.handleEvent('unlink', path))
      .on('ready', () => {
        this.isReady = true;
        this.emit('ready');
      })
      .on('error', (error: Error) => this.emit('error', error));

    // Wait for initial scan to complete
    return new Promise((resolve) => {
      if (this.isReady) {
        resolve();
      } else {
        this.once('ready', () => resolve());
      }
    });
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.pendingChanges.clear();
    this.isReady = false;
  }

  /**
   * Get list of watched paths
   */
  getWatchedPaths(): string[] {
    if (!this.watcher) return [];
    const watched = this.watcher.getWatched();
    const paths: string[] = [];
    for (const [dir, files] of Object.entries(watched)) {
      for (const file of files as string[]) {
        paths.push(dir === '.' ? file : `${dir}/${file}`);
      }
    }
    return paths;
  }

  private handleEvent(type: WatchEvent['type'], path: string): void {
    const event: WatchEvent = {
      type,
      path,
      timestamp: new Date(),
    };

    // Merge with existing pending change (newer event wins)
    this.pendingChanges.set(path, event);

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushChanges();
    }, this.options.debounce);
  }

  private flushChanges(): void {
    if (this.pendingChanges.size === 0) return;

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();
    this.debounceTimer = null;

    this.emit('changes', changes);
  }
}

/**
 * Create a simple file watcher for YAML files
 */
export function createYamlWatcher(options?: WatcherOptions): FileWatcher {
  return new FileWatcher({
    ...options,
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      ...(options?.ignored ?? []),
    ],
  });
}
