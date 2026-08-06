# Contributing to TempeMail

Thanks for taking the time to contribute! 🥢

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## How to contribute

### Report a bug

Open an [issue](https://github.com/ghufronainun/tempe-mail/issues/new?template=bug_report.md) and include:

- TempeMail version / commit SHA
- Steps to reproduce
- Expected vs actual behavior
- Logs or screenshots (redact any personal data)

### Suggest a feature

Open an [issue](https://github.com/ghufronainun/tempe-mail/issues/new?template=feature_request.md) describing:

- The problem you're solving
- A rough sketch of the solution
- Any alternatives you considered

### Submit a PR

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature` or `fix/your-fix`
3. Make your changes
4. **Run the full quality gate before committing:**
   ```bash
   npm run typecheck   # must pass with zero errors
   npm test            # must pass — add tests for new behavior
   ```
5. Commit with a descriptive message (see [Conventional Commits](#conventional-commits))
6. Push and open a PR with a clear description

## Quality gate

Your PR must pass CI (`.github/workflows/ci.yml`), which runs:

- `npm run typecheck`
- `npm test`

If you add new API endpoints, update `API.md`. If you change setup behavior, update `README.md`.

## Conventions

- **No external UI frameworks** — the frontend is vanilla HTML/CSS/JS by design
- **All class names must be original to TempeMail** — nothing copied from other projects
- **Zod for all API input validation**
- **TypeScript strict mode** — no `any` where you can avoid it
- **Tests alongside code** — new modules ship with a matching `tests/*.test.ts`
- **Secrets never in code** — use `.env` + `wrangler.toml` vars

## Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: short description        # new feature
fix: short description         # bug fix
docs: short description        # documentation only
chore: short description       # tooling / maintenance
test: short description        # tests only
refactor: short description    # no behavior change
```

## Project structure

See [README → Project Structure](README.md#project-structure) and [AGENTS.md](AGENTS.md) for orientation.

## Questions?

Open a [discussion](https://github.com/ghufronainun/tempe-mail/discussions) or an issue — happy to help.
