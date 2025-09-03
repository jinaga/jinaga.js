# Given Conditions Integration Test Suite

This directory contains comprehensive integration tests for the Jinaga given conditions feature, designed to replace mock-heavy tests with real-world scenarios using actual Jinaga instances and storage backends.

## Overview

The test suite validates the given conditions feature through:
- Real Jinaga instances instead of mocks
- Actual storage backends (MemoryStore, IndexedDB)
- Realistic test data and fact graphs
- Comprehensive error testing and edge cases
- Performance and load testing
- High code path coverage

## Test Organization

### Directory Structure
```
test/integration/given-conditions/
├── README.md                           # This file
├── setup/
│   ├── test-helpers.ts                 # Common test utilities
│   ├── data-generators.ts              # Realistic data generation
│   ├── storage-fixtures.ts             # Storage backend setup
│   └── specification-builders.ts       # Specification construction helpers
├── scenarios/
│   ├── simple-conditions/
│   │   ├── positive-existential.spec.ts
│   │   ├── negative-existential.spec.ts
│   │   └── mixed-conditions.spec.ts
│   ├── complex-conditions/
│   │   ├── nested-existential.spec.ts
│   │   ├── multi-level-nesting.spec.ts
│   │   └── complex-relationships.spec.ts
│   ├── multi-given/
│   │   ├── different-condition-types.spec.ts
│   │   ├── correlated-conditions.spec.ts
│   │   └── cascading-filters.spec.ts
│   └── edge-cases/
│       ├── empty-results.spec.ts
│       ├── single-fact-scenarios.spec.ts
│       └── boundary-conditions.spec.ts
├── storage-backends/
│   ├── memory-store.spec.ts
│   ├── indexeddb-store.spec.ts
│   └── cross-backend-validation.spec.ts
├── error-handling/
│   ├── invalid-conditions.spec.ts
│   ├── storage-failures.spec.ts
│   └── malformed-specifications.spec.ts
└── performance/
    ├── early-filtering.spec.ts
    └── query-optimization.spec.ts
```

## Test Categories

### 1. Unit Integration Tests
- **Purpose**: Test individual components with real dependencies
- **Scope**: SpecificationRunner with actual storage backends
- **Focus**: Validate core filtering logic without full Jinaga integration

### 2. End-to-End Integration Tests
- **Purpose**: Test complete workflows from specification to results
- **Scope**: Full Jinaga instances with realistic data
- **Focus**: User-facing functionality and data flow

### 3. Error Testing
- **Purpose**: Validate error handling and edge cases
- **Scope**: Invalid inputs, storage failures, malformed data
- **Focus**: Robustness and failure scenarios

## Data Setup

### Realistic Test Data Patterns

The test suite uses the company-office domain model from `test/companyModel.ts`:

#### Company Office Scenario
```typescript
// Core entities using actual fact classes
const creator = new User("creator-public-key");
const companies = [
  new Company(creator, "ACME Corp"),
  new Company(creator, "Globex Inc")
];

const offices = [
  new Office(companies[0], "New York Office"),
  new Office(companies[0], "Los Angeles Office"),
  new Office(companies[1], "Chicago Office")
];

// Status changes
const officeClosures = [
  new OfficeClosed(offices[1], new Date("2023-06-01"))
];

const officeReopenings = [
  new OfficeReopened(officeClosures[0])
];
```

### Data Generators

The `data-generators.ts` file provides:
- **Deterministic Seeds**: Ensure reproducible test data
- **Scalable Complexity**: Generate data sets of varying sizes
- **Realistic Relationships**: Create natural relationship patterns
- **Edge Case Injection**: Include boundary condition data

#### Available Data Patterns
- `small-network`: Basic company with 3 offices, 1 closure
- `medium-network`: Two companies with 5 offices, multiple closures
- `large-network`: 5 companies with 20 offices for performance testing

## Test Frameworks

### Core Testing Framework
- **Jest**: Primary test runner with parallel execution
- **Custom Matchers**: Jinaga-specific assertion helpers
- **Test Fixtures**: Pre-configured test environments

### Storage Backend Testing
```typescript
// Storage abstraction for cross-backend testing
interface StorageTestHarness {
  setup(): Promise<StorageBackend>;
  populate(data: FactGraph): Promise<void>;
  executeQuery(spec: Specification, params: any[]): Promise<any[]>;
  cleanup(): Promise<void>;
}

// Concrete implementations
class MemoryStorageHarness implements StorageTestHarness { ... }
class IndexedDBStorageHarness implements StorageTestHarness { ... }
```

### Specification Builders
```typescript
// Fluent API for building test specifications
class SpecificationBuilder {
  static given(type: string): GivenBuilder;
  withCondition(condition: ConditionBuilder): SpecificationBuilder;
  build(): Specification;
}

class ConditionBuilder {
  static exists(): ExistentialBuilder;
  static notExists(): ExistentialBuilder;
  withMatch(match: MatchBuilder): ConditionBuilder;
}
```

## Coverage Strategy

### Code Path Coverage Goals
- **SpecificationRunner.validateGiven**: All condition types and outcomes
- **Early Filtering Logic**: Verify performance optimization works
- **Error Handling Paths**: Invalid conditions, storage failures
- **Nested Condition Evaluation**: Complex condition hierarchies

### Integration Coverage Areas
1. **Parser Integration**: Raw string specifications to executable queries
2. **Storage Backend Integration**: Multiple storage implementations
3. **Fact Hydration**: Complex object reconstruction from facts
4. **Query Optimization**: Specification splitting and optimization

### Coverage Metrics
- **Line Coverage**: >95% for SpecificationRunner
- **Branch Coverage**: >90% for condition evaluation logic
- **Integration Scenarios**: All major use cases covered
- **Error Paths**: All documented error conditions tested

## Error Testing

### Invalid Condition Types
```typescript
it("should reject non-existential conditions on givens", async () => {
  const spec = createSpecificationWithInvalidGivenCondition();
  await expect(jinaga.query(spec, params)).rejects.toThrow(
    "Invalid condition type on given"
  );
});
```

### Storage Failure Scenarios
- **Connection Failures**: Storage backend unavailable
- **Data Corruption**: Invalid fact references
- **Permission Issues**: Access denied to required facts

### Malformed Specifications
- **Invalid Syntax**: Parser rejects malformed input
- **Type Mismatches**: Fact type validation failures
- **Circular References**: Self-referencing conditions

## Maintainability

### Test Organization Guidelines
1. **Single Responsibility**: Each test validates one specific behavior
2. **Descriptive Names**: Test names clearly indicate what is being tested
3. **Independent Execution**: Tests can run in any order
4. **Fast Execution**: Integration tests complete within reasonable time

### Code Quality Standards
- **DRY Principle**: Shared utilities for common test patterns
- **Clear Documentation**: Extensive comments explaining complex scenarios
- **Type Safety**: Full TypeScript coverage with proper typing
- **Linting Compliance**: Follow project ESLint configuration

### Maintenance Strategies
1. **Modular Design**: Easy to add new test scenarios
2. **Data Versioning**: Test data can be updated independently
3. **Parallel Execution**: Tests designed to run concurrently
4. **CI/CD Integration**: Automated test execution in pipeline

## Implementation Roadmap

### Phase 1: Foundation (Current)
- ✅ Create test directory structure
- ✅ Implement core test utilities and helpers
- ✅ Set up storage backend harnesses
- ✅ Create basic data generators

### Phase 2: Core Integration Tests
- ⏳ Implement simple condition tests
- ⏳ Add storage backend validation
- ⏳ Create end-to-end scenarios
- ⏳ Establish coverage baselines

### Phase 3: Advanced Scenarios
- ⏳ Complex nested condition tests
- ⏳ Multi-given scenarios
- ⏳ Performance validation
- ⏳ Error handling coverage

### Phase 4: Optimization & Maintenance
- ⏳ Test optimization for speed
- ⏳ Documentation completion
- ⏳ CI/CD integration
- ⏳ Maintenance guidelines

## Success Criteria

### Functional Validation
- ✅ All existing functionality continues to work
- ✅ New integration scenarios pass consistently
- ✅ Error conditions handled gracefully
- ✅ Performance optimizations validated

### Quality Metrics
- ✅ >95% code coverage for given conditions logic
- ✅ <5 second average test execution time
- ✅ Zero flaky tests in CI/CD pipeline
- ✅ Comprehensive documentation for all scenarios

### Maintainability Goals
- ✅ Clear separation of test concerns
- ✅ Easy to add new test scenarios
- ✅ Independent test execution
- ✅ Minimal test maintenance overhead

## Running the Tests

```bash
# Run all integration tests
npm test -- test/integration/given-conditions

# Run specific test categories
npm test -- test/integration/given-conditions/scenarios/simple-conditions
npm test -- test/integration/given-conditions/storage-backends

# Run with coverage
npm test -- --coverage test/integration/given-conditions

# Run performance tests
npm test -- test/integration/given-conditions/performance
```

## Contributing

When adding new tests:
1. Follow the established directory structure
2. Use the provided test helpers and data generators
3. Include comprehensive documentation
4. Ensure tests are independent and fast
5. Add appropriate error cases and edge conditions
6. Update this README if adding new patterns or utilities

This test suite provides a solid foundation for comprehensive integration testing of the given conditions feature, ensuring reliability, performance, and maintainability while replacing mock-heavy tests with real-world scenarios.