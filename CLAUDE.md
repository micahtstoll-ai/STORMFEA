# STORMFEA Project Guidelines for Claude AI

## Project Overview
STORMFEA is an FDM-aware finite element analysis tool built with TypeScript/Node.js and React. The project uses npm for dependency management and runs automated tests via GitHub Actions.

## Critical Files & Safety Rules

### Package Lock File (package-lock.json)
**CRITICAL**: This file MUST remain in the repository and be included in every commit.

**Rules:**
- ✅ DO: Include `package-lock.json` in all commits
- ✅ DO: Verify the lock file exists before creating PRs
- ✅ DO: Run `npm install` or `npm ci` if updating dependencies
- ❌ DON'T: Exclude or ignore `package-lock.json`
- ❌ DON'T: Delete `package-lock.json` during refactoring
- ❌ DON'T: Create commits that remove this file

**Why:** The lock file ensures all CI environments use identical dependency versions. Without it:
1. GitHub Actions workflows fail (`npm ci` requires the lock file)
2. Builds become non-reproducible
3. Different developers get different packages installed
4. Pull request CI fails, blocking merges

### Git Safety Checklist
Before creating a commit or PR, verify:
- [ ] `package-lock.json` is present: `ls package-lock.json`
- [ ] Lock file changes are intentional: `git diff package-lock.json`
- [ ] No critical build files were accidentally removed

### Workflow Files (.github/workflows/)
These files define CI/CD behavior. Before modifying:
- Test changes locally first
- Ensure `npm ci` and `npm run test` pass locally
- Document any new environment variables needed

## Common Tasks

### Adding Dependencies
```bash
npm install <package-name>
# This automatically updates package-lock.json
# Commit both package.json and package-lock.json
```

### Creating a PR
```bash
git add package.json package-lock.json [other-files]
git commit -m "feat: description of changes"
git push origin your-branch
```

### Debugging CI Failures
1. Check the GitHub Actions logs first
2. Run `npm ci` locally to reproduce dependency issues
3. Run `npm run test` to reproduce test failures
4. Look for errors in TypeScript compilation or test execution

## Project Structure
- `server/` - Node.js backend (TypeScript)
- `client/` - React frontend (TypeScript)
- `server/tests/` - Test files
- `.github/workflows/` - CI/CD pipeline definitions
- `package.json` - Project dependencies
- `package-lock.json` - Locked dependency versions (DO NOT DELETE)
- `tsconfig.json` - TypeScript configuration

## GitHub Actions Workflows
1. **test.yml** - Runs on every push/PR to main
   - Installs dependencies via `npm ci`
   - Compiles TypeScript
   - Runs solver validation tests

2. **design-research.yml** - Weekly AI design research
   - Requires ANTHROPIC_API_KEY secret
   - Runs design analysis and improvements

3. **nightly-design-loop.yml** - Nightly automated design loop
   - Requires ANTHROPIC_API_KEY and GITHUB_TOKEN
   - Creates design improvement PRs

## Prevention Guidelines for Automated Commits
When making automated PRs or commits:
1. Always run: `ls -la package-lock.json` to verify existence
2. Always verify: `git diff package-lock.json` shows expected changes only
3. Always test: Run `npm ci && npm run test` before pushing
4. Never use: `git add -A` or `git add .` - add files explicitly
5. Never delete: Build artifacts (dist/), lock files, or config files

## Questions?
If you need clarification on these guidelines, ask in the GitHub issue or PR description.
