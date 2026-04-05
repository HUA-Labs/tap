# Contributing to TAP

Thank you for your interest in contributing to TAP (Terminal Agent Protocol)! This document provides guidelines and instructions for contributing to our cross-model AI agent communication framework.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Submitting Changes](#submitting-changes)
- [Style Guidelines](#style-guidelines)
- [Testing](#testing)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to:

- **Be respectful**: Treat everyone with respect. Healthy debate is encouraged, but harassment is not tolerated.
- **Be constructive**: Provide constructive feedback and be open to receiving it.
- **Focus on what's best for the community**: Prioritize the collective benefit of the protocol and its users.
- **Show empathy**: Understand that we all have different backgrounds and perspectives.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (`>=22.6.0`, as specified in `package.json` engines)
- **pnpm** (used by the project) or **npm**
- **Git**

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/HUA-Labs/tap.git
   cd tap
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Build the project**:
   ```bash
   pnpm run build
   ```

4. **Verify installation**:
   ```bash
   pnpm test
   ```

## Development Workflow

### Branching Strategy

- `main` — Production-ready code
- Feature branches — Create from `main` using the naming convention:
  - `feature/description` for new features
  - `fix/description` for bug fixes
  - `docs/description` for documentation updates
  - `refactor/description` for code refactoring

### Building

Compile TypeScript to JavaScript:
```bash
pnpm run build
```

Watch mode for development:
```bash
pnpm run dev
```

### Code Quality

Before submitting changes, ensure:

1. **Type checking passes**:
   ```bash
   pnpm run type-check
   ```

2. **All tests pass**:
   ```bash
   pnpm test
   ```

## Submitting Changes

### Pull Request Process

1. **Fork the repository** and create your branch from `main`.

2. **Make your changes** following our style guidelines.

3. **Add or update tests** as necessary.

4. **Update documentation** if your changes affect usage or architecture.

5. **Ensure all checks pass**:
   - TypeScript compilation
   - Tests
   - Linting (if applicable)

6. **Fill out the pull request template** with:
   - Clear description of changes
   - Motivation for the changes
   - Any breaking changes
   - Testing performed

7. **Request review** from maintainers.

8. **Address review feedback** promptly.

### Commit Message Guidelines

We follow conventional commits:

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `style:` — Code style changes (formatting, no logic change)
- `refactor:` — Code refactoring
- `test:` — Adding or updating tests
- `chore:` — Maintenance tasks

Example:
```
feat: add support for custom comms directories

Implements --comms-dir flag to allow users to specify
custom locations for the communication directory.
```

## Style Guidelines

### TypeScript

- Follow the [TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- Use strict TypeScript configuration
- Prefer `const` and `let` over `var`
- Use explicit return types for public functions
- Maximum line length: 100 characters
- Use 2 spaces for indentation

### Code Organization

```
src/
├── index.ts          # Main entry point
├── cli.ts            # CLI entry point
├── types.ts          # TypeScript type definitions
├── __tests__/        # Test files
├── adapters/         # Model/provider adapters
├── api/              # API layer
├── bridges/          # Bridge implementations
├── commands/         # CLI command implementations
├── config/           # Configuration handling
├── engine/           # Core engine logic
├── permissions/      # Permission system
├── routing/          # Message routing
└── runtime/          # Runtime environment
```

### Error Handling

- Use descriptive error messages
- Prefer throwing errors over returning null/undefined
- Handle edge cases explicitly
- Log errors appropriately for debugging

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch
```

### Writing Tests

We use **Vitest** for testing. Tests should be placed in the `src/__tests__/` directory or co-located with source files as `*.test.ts`.

Example test structure:
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../src/myModule';

describe('myFunction', () => {
  it('should handle valid input correctly', () => {
    const result = myFunction('valid-input');
    expect(result).toBe('expected-output');
  });

  it('should throw on invalid input', () => {
    expect(() => myFunction('')).toThrow('Invalid input');
  });
});
```

### Test Coverage

Aim for high test coverage on:
- CLI commands
- Core communication logic
- Error handling paths

## Community

### Communication Channels

- **GitHub Issues**: For bug reports and feature requests

TAP is a growing project currently maintained by a small team. We plan to start with **GitHub Discussions** as the first community channel, then expand to other platforms (such as Discord) as the project grows.

### Getting Help

If you need help:

1. Check existing documentation and README
2. Search closed issues for similar questions
3. Open a new GitHub issue for bugs or specific questions

### Reporting Bugs

When reporting bugs, please include:

- **Description**: Clear description of the bug
- **Steps to Reproduce**: Minimal steps to reproduce the issue
- **Expected Behavior**: What you expected to happen
- **Actual Behavior**: What actually happened
- **Environment**: Node.js version, OS, TAP version
- **Logs**: Relevant error messages or logs

### Requesting Features

When requesting features:

- Describe the use case
- Explain why existing solutions don't work
- Provide examples if possible
- Be open to discussion about implementation

### Recognition

Contributors will be recognized in our release notes and documentation. Significant contributions may be eligible for additional rewards at the team's discretion.

---

Thank you for helping build the future of cross-model AI agent communication!
