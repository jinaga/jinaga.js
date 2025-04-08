# IndexedDB Queue

The IndexedDB Queue is an implementation of the Queue interface that uses the browser's IndexedDB API for storage. It provides methods for enqueueing, dequeueing, and peeking at fact envelopes.

## Peek Function

The `peek` function retrieves all fact envelopes currently in the queue, along with their complete transitive closure of predecessors. This ensures that when facts are processed from the queue, all of their dependencies are available.

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
6. Returns a combined array of the original envelopes and their ancestor envelopes

### Performance Considerations

- The function uses the `distinct` utility to remove duplicate ancestors, ensuring that each fact is only included once in the result
- Facts that are already in the queue are not duplicated in the ancestor list
- The implementation efficiently handles potentially large ancestor sets

### Example Usage

```typescript
const queue = new IndexedDBQueue('my-index');

// Peek at the queue
const envelopes = await queue.peek();

// Process the envelopes
for (const envelope of envelopes) {
  // Process each fact envelope
  // All predecessors are guaranteed to be included in the array
}
```

## Other Queue Methods

### Enqueue

```typescript
enqueue(envelopes: FactEnvelope[]): Promise<void>
```

Adds fact envelopes to the queue for later processing.

### Dequeue

```typescript
dequeue(envelopes: FactEnvelope[]): Promise<void>
```

Removes fact envelopes from the queue after they have been processed.