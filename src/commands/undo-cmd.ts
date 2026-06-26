import { undoLast, redoLast, journalSize } from '../session/undo-journal.js';
import { theme } from '../ui/theme.js';

export async function undoCommand(sub: 'undo' | 'redo' | 'status'): Promise<string> {
  if (sub === 'status') {
    const size = journalSize();
    return `${theme.brand('Undo journal')} ${theme.dim(`undo: ${size.undo} redo: ${size.redo}`)}\n`;
  }

  if (sub === 'undo') {
    const result = undoLast();
    if (!result) return theme.warn('Nothing to undo.\n');
    return theme.ok(`✔ undone ${result.entry.path}\n`);
  }

  const result = redoLast();
  if (!result) return theme.warn('Nothing to redo.\n');
  return theme.ok(`✔ redone ${result.entry.path}\n`);
}
