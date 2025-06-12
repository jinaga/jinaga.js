# Jinaga Graph Serialization Protocol

## Overview

The Jinaga Graph Serialization Protocol is a text-based format for serializing and deserializing directed acyclic graphs (DAGs) of facts. The protocol is designed to efficiently represent immutable facts with their relationships (predecessors) and cryptographic signatures in a streaming format.

## Core Concepts

### Facts
A **fact** is an immutable data structure with:
- **Type**: A string identifier (e.g., "MyApp.Root", "MyApp.Child")
- **Hash**: A cryptographic hash computed from the fact's content
- **Fields**: Key-value pairs containing the fact's data
- **Predecessors**: References to other facts that this fact depends on

### Fact Envelopes
A **fact envelope** wraps a fact with its cryptographic signatures:
- **Fact**: The core fact data
- **Signatures**: Array of digital signatures from different public keys

### Predecessors
Facts can reference other facts through **predecessor relationships**:
- Each predecessor has a **role** (string key)
- A role can reference either a single fact or an array of facts
- References are made by fact type and hash

## Protocol Structure

The protocol uses a line-based text format where each line contains either:
1. JSON-encoded data
2. Protocol control markers (e.g., `PK0`, `PK1`)
3. Empty lines as separators

### Basic Format

```
[Fact Block 1]
[Public Key Declaration]
[Fact Block 2]
[Public Key Declaration]
[Fact Block 3]
...
```

Public key declarations can appear at any point in the stream, interspersed with fact blocks as needed.

## Public Key Management

Public keys are declared on-demand when first encountered and referenced by index to avoid repetition. Key declarations can appear anywhere in the stream, not just at the beginning.

### Public Key Declaration
```
PK{index}
"{publicKey}"

```

**Format:**
- Line 1: `PK` followed by zero-based index number
- Line 2: JSON-encoded public key string
- Line 3: Empty line separator

**Dynamic Declaration:**
Public keys are declared the first time they are needed, which may be:
- Before the first fact that uses them
- Interspersed between fact blocks
- At any point during the stream processing

**Example:**
```
PK0
"public-key-string-1"

PK1
"public-key-string-2"

```

## Fact Serialization

Each fact is serialized as a block with the following structure:

### Fact Block Format
```
"{type}"
{predecessorIndexes}
{fields}
[Signature Lines]

```

**Components:**
1. **Type Line**: JSON-encoded fact type string
2. **Predecessor Line**: JSON object mapping roles to fact indexes
3. **Fields Line**: JSON object containing fact data
4. **Signature Lines** (optional): Zero or more signature references
5. **Empty Line**: Block separator

### Predecessor Indexing

Predecessors are referenced by their position in the serialization stream (zero-based indexing).

**Single Predecessor:**
```json
{"role": 0}
```

**Multiple Predecessors:**
```json
{"role": [0, 1, 2]}
```

**No Predecessors:**
```json
{}
```

### Signature Format

Signatures reference previously declared public keys:

```
PK{publicKeyIndex}
"{signatureString}"
```

**Example:**
```
PK0
"signature-data-1"
PK1
"signature-data-2"
```

## Data Type Encoding

### Strings
All strings are JSON-encoded with proper escaping:
```json
"MyApp.Root"
"Hello \"World\""
```

### Objects
Field data and predecessor collections are JSON objects:
```json
{"identifier": "root", "value": 42}
{"parent": 0, "children": [1, 2]}
```

### Arrays
Arrays are used for multiple predecessors in the same role:
```json
{"tags": [0, 1, 2]}
```

### Special Values
- `null`: JSON null
- `undefined`: Not directly supported (omitted from objects)
- Numbers: JSON numbers
- Booleans: JSON booleans

## Complete Examples

### Example 1: Single Fact Without Signatures

**Input Data:**
```typescript
{
  fact: {
    type: "MyApp.Root",
    hash: "roothash",
    fields: { identifier: "root" },
    predecessors: {}
  },
  signatures: []
}
```

**Serialized Output:**
```
"MyApp.Root"
{}
{"identifier":"root"}

```

### Example 2: Two Related Facts Without Signatures

**Input Data:**
```typescript
[
  {
    fact: {
      type: "MyApp.Root",
      hash: "roothash",
      fields: {},
      predecessors: {}
    },
    signatures: []
  },
  {
    fact: {
      type: "MyApp.Child",
      hash: "childhash",
      fields: {},
      predecessors: {
        root: { type: "MyApp.Root", hash: "roothash" }
      }
    },
    signatures: []
  }
]
```

**Serialized Output:**
```
"MyApp.Root"
{}
{}

"MyApp.Child"
{"root":0}
{}

```

### Example 3: Facts With Multiple Signatures

**Input Data:**
```typescript
[
  {
    fact: {
      type: "MyApp.Root",
      hash: "roothash",
      fields: {},
      predecessors: {}
    },
    signatures: [
      { publicKey: "public", signature: "signature" }
    ]
  },
  {
    fact: {
      type: "MyApp.Child",
      hash: "childhash",
      fields: {},
      predecessors: {
        root: { type: "MyApp.Root", hash: "roothash" }
      }
    },
    signatures: [
      { publicKey: "public", signature: "signature1" },
      { publicKey: "public2", signature: "signature2" }
    ]
  }
]
```

**Serialized Output:**
```
PK0
"public"

"MyApp.Root"
{}
{}
PK0
"signature"

PK1
"public2"

"MyApp.Child"
{"root":0}
{}
PK0
"signature1"
PK1
"signature2"

```

**Note:** In this example, `PK0` is declared before the first fact that uses it, and `PK1` is declared later when first needed by the second fact. This demonstrates the dynamic, on-demand nature of public key declarations.

## Deserialization Process

### Hash Computation
During deserialization, fact hashes are recomputed from the fields and predecessors using the [`computeHash`](../src/fact/hash.ts) function. The original hash from serialization is not preserved but recalculated.

### Reference Resolution
Predecessor references are resolved using the order of facts in the stream:
- Index 0 = first fact
- Index 1 = second fact
- etc.

### Public Key Resolution
Public key references are resolved using declaration order:
- Keys can be declared at any point in the stream
- Each key gets the next available index when first declared
- Subsequent references use the assigned index

### Batch Processing
The deserializer processes facts in batches (default: 20 facts) for efficiency.

## Protocol Characteristics

### Streaming Support
- Facts can be processed as they arrive
- No need to buffer entire graph in memory
- Supports incremental processing
- Public keys are processed dynamically as declarations are encountered

### Deduplication
- Facts with identical type and hash are automatically deduplicated
- Only the first occurrence is serialized
- Subsequent references use the same index

### Ordering Requirements
- Public keys must be declared before use, but can appear anywhere in the stream
- Facts must be serialized before being referenced as predecessors
- Topological ordering is enforced for fact dependencies
- Public key declarations are processed dynamically as encountered

### Error Handling
- Invalid JSON causes parsing errors
- Out-of-range predecessor references are rejected
- Missing public key declarations are detected
- Malformed signature blocks are caught

## Versioning

The current protocol has no explicit version markers. The format is identified by:
- Line-based structure
- JSON encoding for data
- `PK{index}` markers for public keys
- Empty line separators

## Performance Considerations

### Memory Efficiency
- Streaming design minimizes memory usage
- Public key deduplication reduces size
- Fact deduplication prevents redundancy

### Network Efficiency
- Text-based format is compressible
- Minimal overhead for small graphs
- Efficient for sparse signature coverage

### Processing Efficiency
- Line-by-line parsing
- Incremental hash computation
- Batch processing for I/O efficiency

## Implementation Notes

### Key Classes
- [`GraphSerializer`](../src/http/serializer.ts): Handles serialization
- [`GraphDeserializer`](../src/http/deserializer.ts): Handles deserialization
- [`FactEnvelope`](../src/storage.ts:36): Core data structure

### Dependencies
- JSON encoding/decoding for data representation
- Hash computation for fact integrity
- Streaming I/O for large graphs

### Thread Safety
- Serializers maintain internal state (not thread-safe)
- Each serialization operation should use a fresh instance
- Deserializers are stateful and not reentrant