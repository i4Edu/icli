# iCopilot — Release Process

Releases are SemVer. Automation lives in `scripts/release.mjs`,
`scripts/changelog.mjs`, and `.github/workflows/release.yml`.

## Local cut

```bash
npm run release:patch   # or release:minor / release:major
```

`release.mjs` will:

1. Verify the working tree is clean (use `--force` to override).
2. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
3. Bump `package.json` version.
4. Move `## [Unreleased]` in `CHANGELOG.md` to the new version with today's
   date and insert a fresh empty Unreleased section.
5. Commit `chore(release): vX.Y.Z` and tag `vX.Y.Z`.
6. Print next steps (push branch + tag).

If any step fails after the package.json bump, the original `package.json` is
restored automatically.

## Pushing

```bash
git push origin HEAD
git push origin vX.Y.Z
```

The tag push triggers `.github/workflows/release.yml`:

1. Checkout + Node 20 setup
2. `npm ci`
3. `typecheck → lint → test → build → smoke`
4. `npm publish --provenance --access public` (requires `NPM_TOKEN` secret)
5. Creates a GitHub Release with the changelog excerpt as the body.

## Manual publish

```bash
npm run build
npm publish --provenance --access public
```

## Release checklist

- [ ] All open milestone items merged
- [ ] `roadmap.md` and `TODO.md` reflect shipped state
- [ ] `README.md` examples reflect new flags or commands
- [ ] `docs/api.md` stability tiers updated for changed exports
- [ ] `CHANGELOG.md` Unreleased section has a meaningful entry per change
- [ ] Local `npm run release:<level>` succeeds end-to-end
- [ ] Tag pushed; release workflow green; npm artifact verified
