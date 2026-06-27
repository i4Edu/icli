import { compactSession } from '../context/compactor.js';
import { config } from '../config.js';
import { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';

export async function handlePostTurnContextBudget(
  session: Session,
  signal?: AbortSignal,
): Promise<boolean> {
  const used = session.tokenUsage();
  const usageRatio = used / config.contextWindow;

  if (config.autoCompact && usageRatio > config.autoCompactThreshold) {
    const pct = (usageRatio * 100).toFixed(0);
    process.stdout.write(theme.dim(`\n⚡ auto-compacting context (${pct}% full)...\n`));
    const summary = await compactSession(session, signal);
    session.compactInto(summary);
    const freed = Math.max(0, used - session.tokenUsage());
    process.stdout.write(theme.ok(`✔ auto-compacted. Freed ${freed} tokens.\n`));
    return true;
  }

  if (usageRatio > config.contextWarn) {
    process.stdout.write(
      theme.warn(`\n⚠  context ${(usageRatio * 100).toFixed(0)}% full — run /compact to free space.\n`),
    );
  }

  return false;
}
