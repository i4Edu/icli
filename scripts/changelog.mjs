import fs from 'node:fs';

const changelogPath = 'CHANGELOG.md';
const args = process.argv.slice(2);
const bumpIndex = args.indexOf('--bump');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const unreleasedHeading = /^## \[Unreleased\].*$/m;
const match = unreleasedHeading.exec(changelog);

if (!match) {
  console.error('CHANGELOG.md does not contain a ## [Unreleased] section.');
  process.exit(1);
}

const headingStart = match.index;
const headingEnd = headingStart + match[0].length;
const afterHeading = changelog.slice(headingEnd);
const nextHeadingRelative = afterHeading.search(/\n## \[/);
const sectionEnd = nextHeadingRelative === -1 ? changelog.length : headingEnd + nextHeadingRelative;
const sectionContent = changelog.slice(headingEnd, sectionEnd).replace(/^\r?\n/, '').replace(/\s+$/, '');

if (bumpIndex === -1) {
  process.stdout.write(sectionContent ? `${sectionContent}\n` : '');
  process.exit(0);
}

const version = args[bumpIndex + 1];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/changelog.mjs --bump <version>');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const before = changelog.slice(0, headingStart);
const after = changelog.slice(sectionEnd).replace(/^\r?\n/, '');
const freshUnreleased = '## [Unreleased]\n\n';
const released = `## [${version}] - ${today}\n\n${sectionContent || '- No changes recorded.'}\n`;
const next = `${before}${freshUnreleased}${released}${after ? `\n${after}` : ''}`;
fs.writeFileSync(changelogPath, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
console.log(`CHANGELOG.md updated for ${version}`);
