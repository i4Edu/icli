import fg from 'fast-glob';
import { StyleLearner, loadStyleProfile, resetStyleProfile, resolveStyleProfilePath } from '../knowledge/style-learner.js';
import { theme } from '../ui/theme.js';

const STYLE_PATTERNS = [
  'src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'tests/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
];

const STYLE_IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.icopilot/**', '**/coverage/**'];

export async function styleCommand(args: string[], cwd: string): Promise<string> {
  const [rawSubcommand = 'show'] = args;
  const subcommand = rawSubcommand.toLowerCase();

  try {
    switch (subcommand) {
      case 'show':
      case 'current':
        return showStyleProfile(cwd);
      case 'learn':
        return learnStyleProfile(cwd);
      case 'reset':
      case 'clear':
        return resetStyleProfile(cwd)
          ? `${theme.ok('✔ cleared learned style profile.\n')}`
          : `${theme.dim('No learned style profile to clear.\n')}`;
      default:
        return theme.warn('usage: /style [learn|reset]\n');
    }
  } catch (err) {
    return theme.err(`style: ${(err as Error)?.message || err}\n`);
  }
}

async function learnStyleProfile(cwd: string): Promise<string> {
  const files = await fg(STYLE_PATTERNS, {
    cwd,
    absolute: true,
    onlyFiles: true,
    unique: true,
    ignore: STYLE_IGNORE,
  });
  if (files.length === 0) return theme.warn('No source files found to learn from.\n');

  const learner = new StyleLearner();
  const profile = learner.analyze(files);
  const profilePath = resolveStyleProfilePath(cwd);
  learner.save(profilePath);

  return [
    `${theme.ok('✔ learned style profile')} ${theme.dim(`(${files.length} files)`)} ${theme.hl(
      profilePath,
    )}`,
    renderProfile(profile),
  ].join('\n');
}

function showStyleProfile(cwd: string): string {
  const profile = loadStyleProfile(cwd);
  if (!profile) {
    return `${theme.brand('Style profile')}\n  ${theme.dim('No learned profile. Run /style learn first.')}\n`;
  }
  return renderProfile(profile);
}

function renderProfile(profile: NonNullable<ReturnType<typeof loadStyleProfile>>): string {
  const entries: Array<[string, string | number]> = [
    ['indentation', profile.indentation],
    ['quotes', profile.quotes],
    ['semicolons', profile.semicolons],
    ['trailingComma', profile.trailingComma],
    ['namingConvention', profile.namingConvention],
    ['importStyle', profile.importStyle],
    ['functionStyle', profile.functionStyle],
    ['commentStyle', profile.commentStyle],
    ['maxLineLength', profile.maxLineLength],
  ];

  return `${theme.brand('Style profile')}\n${entries
    .map(([key, value]) => `  ${theme.hl(key.padEnd(16))} ${value}`)
    .join('\n')}\n`;
}
