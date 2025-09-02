# Given Conditions Integration Test Suite Design

## Overview

This document outlines a comprehensive integration test suite for the Jinaga given conditions feature, designed to replace the existing mock-heavy tests with real-world integration scenarios. The suite focuses on testing with actual Jinaga instances, real storage backends, and realistic data patterns.

## Current Test Coverage Gaps

### Identified Issues
1. **Mock-Heavy Testing**: Current runtime tests use `MockFactSource` instead of real storage backends
2. **Limited Integration**: No end-to-end tests covering the full specification lifecycle
3. **Storage Backend Coverage**: No tests with actual IndexedDB or memory stores
4. **Realistic Data Patterns**: Test data doesn't reflect real-world fact graph complexity
5. **Performance Validation**: No performance testing for early filtering optimization
6. **Complex Scenarios**: Missing tests for nested conditions and multiple givens

## Test Architecture

### Directory Structure
```
test/integration/given-conditions/
├── README.md                           # Test suite documentation
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

### Test Organization Principles
- **Separation of Concerns**: Each test file focuses on a specific aspect
- **Data Isolation**: Tests use independent data sets to avoid interference
- **Storage Agnostic**: Core logic tests run against multiple storage backends
- **Progressive Complexity**: Simple tests first, complex scenarios later

## Test Categories

### 1. Unit Integration Tests
**Purpose**: Test individual components with real dependencies
**Scope**: SpecificationRunner with actual storage backends
**Focus**: Validate core filtering logic without full Jinaga integration

### 2. End-to-End Integration Tests
**Purpose**: Test complete workflows from specification to results
**Scope**: Full Jinaga instances with realistic data
**Focus**: User-facing functionality and data flow

### 3. Error Testing
**Purpose**: Validate error handling and edge cases
**Scope**: Invalid inputs, storage failures, malformed data
**Focus**: Robustness and failure scenarios

## Test Scenarios

### Simple Conditions
1. **Positive Existential**: Filter facts that MUST have related facts
2. **Negative Existential**: Filter facts that MUST NOT have related facts
3. **Mixed Conditions**: Single given with multiple condition types

### Complex Conditions
1. **Nested Existential**: Conditions within conditions (2-3 levels deep)
2. **Multi-Level Nesting**: Complex relationship traversals
3. **Complex Relationships**: Multiple paths and joins in conditions

### Multiple Givens
1. **Different Condition Types**: Each given has different condition patterns
2. **Correlated Conditions**: Conditions that reference multiple givens
3. **Cascading Filters**: Conditions that progressively narrow results

### Edge Cases
1. **Empty Results**: Conditions that filter out all possible facts
2. **Single Fact Scenarios**: Minimal data sets with specific conditions
3. **Boundary Conditions**: Maximum complexity scenarios

## Data Setup

### Realistic Test Data Patterns

#### Company Office Scenario
```typescript
import { User, Company, Office, OfficeClosed, OfficeReopened } from "../companyModel";

// Core entities
const creator = new User("creator-public-key");
const companies = [
  new Company(creator, "ACME Corp"),
  new Company(creator, "Globex Inc")
];

const offices = [
  new Office(companies[0], "New York Office"),
  new Office(companies[0], "Los Angeles Office"),
  new Office(companies[1], "New York Office")
];

// Status changes
const officeClosures = [
  new OfficeClosed(offices[1], new Date("2023-06-01"))
];

const officeReopenings = [
  new OfficeReopened(officeClosures[0], new Date("2023-09-01"))
];
```

#### Complex Relationship Scenario
```typescript
// Multi-level organizational hierarchy
const users = [...];
const departments = [...];
const projects = [...];
const assignments = [...];
const reviews = [...];
```

### Fact Graph Generators

#### Data Generation Strategy
- **Deterministic Seeds**: Ensure reproducible test data
- **Scalable Complexity**: Generate data sets of varying sizes
- **Realistic Relationships**: Create natural relationship patterns
- **Edge Case Injection**: Include boundary condition data

#### Generator Utilities
```typescript
interface DataGenerator {
  createCompanyNetwork(size: 'small' | 'medium' | 'large'): FactGraph;
  createComplexHierarchy(depth: number): FactGraph;
  injectEdgeCases(graph: FactGraph): FactGraph;
}
```

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

### Phase 1: Foundation (Week 1-2)
- Create test directory structure
- Implement core test utilities and helpers
- Set up storage backend harnesses
- Create basic data generators

### Phase 2: Core Integration Tests (Week 3-4)
- Implement simple condition tests
- Add storage backend validation
- Create end-to-end scenarios
- Establish coverage baselines

### Phase 3: Advanced Scenarios (Week 5-6)
- Complex nested condition tests
- Multi-given scenarios
- Performance validation
- Error handling coverage

### Phase 4: Optimization & Maintenance (Week 7-8)
- Test optimization for speed
- Documentation completion
- CI/CD integration
- Maintenance guidelines

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

This design provides a solid foundation for comprehensive integration testing of the given conditions feature, ensuring reliability, performance, and maintainability while replacing mock-heavy tests with real-world scenarios.