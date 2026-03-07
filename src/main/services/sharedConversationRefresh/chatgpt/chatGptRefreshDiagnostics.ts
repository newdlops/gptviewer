import type { ShareModalProgressSnapshot } from './chatGptShareModalState';

type DiagnosticEntry = {
  at: number;
  message: string;
  phase: string;
};

const MAX_ENTRIES = 40;

export class ChatGptRefreshDiagnostics {
  private readonly entries: DiagnosticEntry[] = [];
  private readonly lastProgressByPhase = new Map<string, string>();
  private readonly startedAt = Date.now();

  record(phase: string, message: string) {
    this.entries.push({
      at: Date.now() - this.startedAt,
      message,
      phase,
    });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
  }

  recordProgress(phase: string, progress: ShareModalProgressSnapshot) {
    const message = [
      `dialog=${progress.hasDialog ? 'y' : 'n'}`,
      `copy=${progress.hasCopyAction ? 'y' : 'n'}`,
      `enabled=${progress.hasEnabledCopyAction ? 'y' : 'n'}`,
      `url=${progress.hasSharedUrlCandidate ? 'y' : 'n'}`,
      `success=${progress.hasCopySuccess ? 'y' : 'n'}`,
      `focus=${progress.hasDocumentFocus ? 'y' : 'n'}`,
      `visibility=${progress.visibilityState}`,
      `copyLabel=${progress.copyActionLabel || '-'}`,
    ].join(' ');
    if (this.lastProgressByPhase.get(phase) === message) {
      return;
    }
    this.lastProgressByPhase.set(phase, message);
    this.record(phase, message);
  }

  toDetail(extraDetail?: string) {
    const lines = this.entries.map(
      (entry) => `[${(entry.at / 1000).toFixed(1)}s] ${entry.phase}: ${entry.message}`,
    );
    return [extraDetail, lines.length > 0 ? `diagnostics:\n${lines.join('\n')}` : '']
      .filter(Boolean)
      .join('\n');
  }
}
