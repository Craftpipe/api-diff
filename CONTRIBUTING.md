# Contributing

Thanks for your interest in contributing!

## Reporting Issues

- Use [GitHub Issues](../../issues) to report bugs or suggest features
- Include steps to reproduce for bugs
- Check existing issues before creating a new one

## Setup

```bash
git clone <this-repo>
npm install
npm test
node index.js --help
```

## Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests (see below)
5. Commit: `git commit -m "feat: add my feature"`
6. Push and open a Pull Request

## Code Style

- Plain JavaScript — no TypeScript, no build step
- `'use strict'` at the top of every file
- CommonJS modules (`require`/`module.exports`)
- Handle errors gracefully — no unhandled throws
- All exported functions must handle `null`/`undefined` arguments without crashing
- No hardcoded credentials or brand names in source files

## Testing

```bash
npm test              # run vitest
npm run test:coverage # run with coverage report
```

- Tests live in `tests/`
- Test behavior, not implementation details
- Test edge cases: null, undefined, empty string, empty array
- All tests must pass before merging

## Architecture

- `index.js` — CLI entry point (argument parsing, command routing)
- `lib/*.js` — core modules (each with a single responsibility)
- `tests/` — vitest unit tests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
