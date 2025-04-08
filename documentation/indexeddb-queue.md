# IndexedDB Queue

The IndexedDB Queue is an implementation of the Queue interface that uses the browser's IndexedDB API for storage. It provides methods for enqueueing, dequeueing, and peeking at fact envelopes.

## Overview

The IndexedDB Queue ensures that facts are processed in the correct order by maintaining strict topological ordering of facts. This means that for any two facts where one depends on the other, the prerequisite fact will always appear earlier in the list.

## Peek Function

The `peek` function retrieves all fact envelopes currently in the queue, along with their complete transitive closure of predecessors. This ensures that when facts are processed from the queue, all of their dependencies are available. The function returns the envelopes in strict topological order, guaranteeing that prerequisite facts appear before the facts that depend on them.

```typescript
peek(): Promise<FactEnvelope[]>
```

### Return Value

The function returns a Promise that resolves to an array of FactEnvelope objects. This array includes:

1. All fact envelopes currently in the queue
2. All transitive predecessors of those facts (the complete ancestor chain)

### Implementation Details

The function:

1. Opens a transaction on the 'queue', 'fact', and 'ancestor' object stores
2. Retrieves all fact envelopes from the queue
3. For each envelope, retrieves its ancestors from the ancestor table
4. For each ancestor, retrieves the corresponding fact from the fact table
5. Creates fact envelopes for all ancestors
6. Sorts the combined array of envelopes in topological order
7. Validates the topological ordering to ensure correctness
8. Returns the sorted array of envelopes

### Performance Considerations

- The function uses the `distinct` utility to remove duplicate ancestors, ensuring that each fact is only included once in the result
- The function uses the `TopologicalSorter` to sort facts in topological order
- The function validates the topological ordering to ensure that prerequisite facts appear before the facts that depend on them
- The function detects and reports circular dependencies and other ordering violations
- Facts that are already in the queue are not duplicated in the ancestor list
- The implementation efficiently handles potentially large ancestor sets

### Example Usage

```typescript
const queue = new IndexedDBQueue('my-index');

// Peek at the queue
const envelopes = await queue.peek();

// Process the envelopes (guaranteed to be in topological order)
for (const envelope of envelopes) {
  // Process each fact envelope
  // All predecessors are guaranteed to be included in the array
  // and to appear before the facts that depend on them
}
```

## Other Queue Methods

### Enqueue

```typescript
enqueue(envelopes: FactEnvelope[]): Promise<void>
```

Adds fact envelopes to the queue for later processing.

## Error Handling

The `peek` function includes comprehensive validation logic to ensure the correctness of the topological ordering:

1. **Circular Dependencies**: If a circular dependency is detected (where fact A depends on fact B, which depends on fact C, which depends on fact A), the function will throw an error with a detailed message.

2. **Missing Prerequisites**: If a fact depends on a prerequisite that is not included in the result, the function will throw an error identifying the missing prerequisite.

3. **Topological Ordering Violations**: If the topological ordering is violated (where a fact appears before one of its prerequisites), the function will throw an error with details about the specific violation.

These error messages provide detailed information to help diagnose and fix issues with the fact dependency graph.

### Dequeue

```typescript
dequeue(envelopes: FactEnvelope[]): Promise<void>
```

Removes fact envelopes from the queue after they have been processed.