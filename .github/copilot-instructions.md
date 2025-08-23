# Jinaga.js

**ALWAYS follow these instructions first** and only fallback to search or bash commands when information here is incomplete or proven incorrect.

Jinaga.js is an end-to-end application state management framework written in TypeScript. The library provides immutable data structures for distributed systems and can run in both browser and Node.js environments.

## Working Effectively

### Bootstrap and Build Process
Execute these commands in order to set up the development environment:

```bash
# Install dependencies - takes ~20 seconds
npm ci

# Build TypeScript code - takes ~3 seconds, VERY fast
npm run build

# Run full test suite - takes ~20 seconds, NEVER CANCEL
npm test
```

**NEVER CANCEL builds or tests** - Total development cycle takes only ~45 seconds. The build is very fast since it's just TypeScript compilation.

### Essential Commands with Timing
- `npm ci` - Install dependencies (20 seconds, set timeout to 60+ seconds)
- `npm run build` - TypeScript compilation (3 seconds, set timeout to 30+ seconds)  
- `npm test` - TypeScript check + Jest tests (20 seconds, set timeout to 60+ seconds)
- `npm run test:watch` - Run tests in watch mode for development
- `npm run clean` - Clean build artifacts

### Validation Requirements
**CRITICAL**: Always test actual library functionality after making changes, not just build success:

1. **Basic Library Functionality Test**:
   ```javascript
   const { JinagaTest } = require('./dist/index.js');
   const j = JinagaTest.create({});
   // Test fact creation and queries
   ```

2. **Multi-Environment Testing**: Test both Node.js and browser compatibility since this library supports both environments.

3. **State Management Scenarios**: Test creating facts, querying data, and observable subscriptions.

### CI Validation
Always run before committing:
- `npm run build` - Must complete without errors
- `npm test` - All 310+ tests must pass
- TypeScript compilation check passes (included in `npm test`)

**NOTE**: ESLint configuration currently has issues and should be avoided. Use TypeScript compilation for code validation instead.

## Repository Structure

### Key Directories
```
src/                 # Main source code
├── index.ts        # Main entry point
├── jinaga.ts       # Core Jinaga class
├── jinaga-test.ts  # Test utilities  
├── jinaga-browser.ts # Browser-specific implementation
├── authentication/ # Authentication modules
├── authorization/  # Authorization logic
├── http/           # HTTP client implementation
├── ws/             # WebSocket implementation
├── managers/       # Various managers (fact, network, etc.)
├── storage.ts      # Storage interfaces
└── util/           # Utility functions

test/               # Jest test files (*Spec.ts pattern)
dist/               # Compiled output (created by build)
examples/           # Usage examples with httpYac
scripts/            # Build and release scripts
.github/workflows/  # CI/CD pipeline
```

### Important Files
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript build configuration  
- `tsconfig.test.json` - TypeScript test configuration
- `jest.config.js` - Jest test configuration
- `README.md` - Basic usage documentation
- `contributing.md` - Development guidelines

## Core Concepts

### Jinaga Instances
Create test instances for development and testing:
```javascript
const { JinagaTest } = require('./dist/index.js');
const j = JinagaTest.create({
  // Optional configuration
  initialState: [],
  user: {},
  device: {}
});
```

### Facts and Queries
Jinaga works with immutable "facts" - data structures representing state:
```javascript
// Create a fact
const user = { type: 'User', name: 'Test User' };
await j.fact(user);

// Query facts (in tests)
const users = await j.query({ type: 'User' });
```

### Replicator Connection
For production usage, connect to a Jinaga replicator:
```javascript
const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});
```

## Environment Considerations

### Browser vs Node.js
- **Browser**: Use `JinagaBrowser.create()` for client applications
- **Node.js**: Use `JinagaTest.create()` for testing and server scenarios
- **Dual Support**: Many modules have environment-specific optimizations

### Docker Replicator
```bash
# Pull and run the replicator (for integration testing)
docker pull jinaga/jinaga-replicator
docker run --name my-replicator -p8080:8080 jinaga/jinaga-replicator
```

**NOTE**: The replicator requires security policies configuration to start properly.

## Testing Guidelines

### Jest Configuration
- Tests follow `*Spec.ts` naming pattern
- Located in `test/` directory
- Run with `npm test` or `npm run test:watch`
- 310+ tests covering core functionality

### Test Categories
- Unit tests for individual modules
- Integration tests for component interaction
- Authorization and authentication tests
- WebSocket protocol tests
- HTTP client tests

## Common Development Tasks

### Making Changes
1. Build and test first to establish baseline: `npm ci && npm run build && npm test`
2. Make minimal, focused changes
3. Test immediately: `npm run build && npm test`
4. Validate actual functionality with realistic scenarios
5. Check TypeScript compilation with `npx tsc --noEmit --project tsconfig.test.json`

### Module Structure
Most modules follow this pattern:
- Core logic in `src/[module]/`
- Tests in `test/[module]/`
- TypeScript interfaces and types
- Support for both browser and Node.js when applicable

### WebSocket Development
The codebase includes extensive WebSocket functionality:
- Protocol handling in `src/ws/`
- Authorization integration
- Connection lifecycle management
- Message routing and handling

## Performance Characteristics

### Build Performance
- TypeScript compilation: ~3 seconds
- Test execution: ~20 seconds for 310+ tests
- Dependency installation: ~20 seconds
- **Total development cycle: ~45 seconds**

### Runtime Performance
- Memory-based storage for tests
- Efficient observable patterns for state updates
- Optimized for both client and server environments

## Known Issues and Limitations

1. **ESLint Configuration**: Currently broken, use TypeScript compiler for linting
2. **Type Dependencies**: Some conflicts between @types/node and DOM types (does not affect build)
3. **Replicator Dependencies**: Docker replicator requires security policies setup
4. **Target Configuration**: Built for ES6/CommonJS modules

## Quick Reference Commands

```bash
# Full development cycle
npm ci && npm run build && npm test

# Watch mode development  
npm run test:watch

# Clean build
npm run clean && npm run build

# Release process (maintainers)
./scripts/release.sh patch
```

Remember: Always validate functionality beyond just successful builds and tests. Create facts, run queries, and test the core state management features that define Jinaga's purpose.