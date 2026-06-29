import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Session } from '../session/session.js';
import { addBookmark, deleteBookmark, getBookmark, listBookmarks } from '../session/bookmarks.js';
import { theme } from '../ui/theme.js';

export function bookmarkCommand(
  session: Session,
  rest: string[],
): { message: string; rewindTo?: number } {
  const action = rest[0]?.toLowerCase() || 'list';

  if (action === 'add') {
    const name = rest[1];
    if (!name) return { message: usage() };
    const index = session.state.messages.length - 1;
    if (index < 0) return { message: theme.warn('No messages to bookmark.') };
    const preview = messagePreview(session.state.messages[index]);
    const bookmark = addBookmark(session.state.id, name, index, preview);
    return { message: `${theme.ok('Bookmarked')} ${bookmark.name} at message ${bookmark.index}.` };
  }

  if (action === 'go') {
    const name = rest[1];
    if (!name) return { message: usage() };
    const bookmark = getBookmark(session.state.id, name);
    if (!bookmark) return { message: theme.warn(`Bookmark not found: ${name}`) };
    return {
      message: `${theme.ok('Rewind')} to ${bookmark.name} at message ${bookmark.index}.`,
      rewindTo: bookmark.index,
    };
  }

  if (action === 'delete' || action === 'del' || action === 'rm') {
    const name = rest[1];
    if (!name) return { message: usage() };
    const deleted = deleteBookmark(session.state.id, name);
    return {
      message: deleted
        ? `${theme.ok('Deleted')} bookmark ${name}.`
        : theme.warn(`Bookmark not found: ${name}`),
    };
  }

  if (action !== 'list') return { message: usage() };

  const bookmarks = listBookmarks(session.state.id);
  if (!bookmarks.length) return { message: 'No bookmarks for this session.' };
  return {
    message: bookmarks
      .map((bookmark) => `${bookmark.name} @ ${bookmark.index}: ${bookmark.preview}`)
      .join('\n'),
  };
}

function usage(): string {
  return 'Usage: /bookmark [list] | /bookmark add <name> | /bookmark go <name> | /bookmark delete <name>';
}

function messagePreview(message: ChatCompletionMessageParam): string {
  return contentToText((message as { content?: unknown }).content).slice(0, 80);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.type === 'string') return JSON.stringify(record);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}
