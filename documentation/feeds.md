# Feed Architecture

This document provides a comprehensive technical overview of Jinaga's feed production pipeline, covering the transformation of specifications into executable feeds, caching strategies, data structures, and communication protocols between clients and replicators.

## Overview

The feed architecture in Jinaga transforms declarative specifications into optimized data feeds that enable efficient fact synchronization between clients and replicators. The system decomposes complex specifications into multiple simpler feeds, each representing a specific level of the data hierarchy, allowing for incremental loading and efficient caching.

## Core Components

### 1. Specification Structure

A [`Specification`](src/specification/specification.ts:71) represents a declarative query with three main components:

- **Given**: Input parameters (labels with types)
- **Matches**: Pattern matching clauses that define relationships
- **Projection**: Output transformation specification

```typescript
interface Specification {
    given: Label[];
    matches: Match[];
    projection: Projection;
}
```

### 2. Feed Builder

The [`buildFeeds()`](src/specification/feed-builder.ts:3) function is the core transformation engine that converts a single specification into multiple feed specifications:

```typescript
export function buildFeeds(specification: Specification): Specification[]
```

#### Feed Generation Algorithm

The feed builder employs a hierarchical decomposition strategy:

1. **Match Processing**: Processes each match clause sequentially, building up the tuple of facts
2. **Existential Condition Handling**: 
   - For positive existential conditions (`E`): Incorporates matches into the current feed
   - For negative existential conditions (`!E`): Creates separate feeds for both the negating tuples and the condition-applied tuples
3. **Projection Expansion**: Recursively processes composite projections to create child feeds

#### Key Transformation Patterns

**Identity Specifications**: Specifications with no matches produce no feeds:
```
(root: Root) { } → []
```

**Simple Specifications**: Single match clauses produce single feeds:
```
(root: Root) {
    child: Child [
        child->root: Root = root
    ]
} → [feed with child relationship]
```

**Existential Condition Decomposition**: Existential conditions generate multiple feeds for logical branching:
```
(user: User, root: Root) {
    assignment: Assignment [
        assignment->user: User = user
        assignment->project: Project->root: Root = root
        !E {
            revoked: Assignment.Revoked [
                revoked->assignment: Assignment = assignment
            ]
        }
    ]
} → [negating feed for revoked assignments, condition-applied feed with !E]
```

**Projection Decomposition**: Composite projections generate multiple feeds:
```
(root: Root) {} => {
    children1 = { c1: Child1 [...] }
    children2 = { c2: Child2 [...] }
} → [feed for c1, feed for c2]
```

**Nested Projections**: Deep hierarchies create feed chains:
```
(root: Root) {
    parent: Parent [...]
} => {
    children = {
        child: Child [...]
    } => {
        grandchildren = {
            grandchild: Grandchild [...]
        }
    }
} → [parent feed, child feed, grandchild feed]
```

**Terminal Projections**: Non-specification projections (field, hash, fact) do not generate feeds:
```
(root: Root) {
    child: Child [
        child->root: Root = root
    ]
} => {
    childName = child.name
    childHash = hash(child)
    childFact = child
} → [single feed with child relationship, terminal projections in result only]
```

### 3. Feed Cache

The [`FeedCache`](src/specification/feed-cache.ts:23) provides efficient storage and retrieval of feed objects using content-based hashing:

```typescript
class FeedCache {
    addFeeds(feeds: Specification[], namedStart: ReferencesByName): string[]
    getFeed(feed: string): FeedObject | undefined
}
```

#### Caching Strategy

- **Content-Based Hashing**: Uses [`computeObjectHash()`](src/fact/hash.ts) on feed identifiers
- **URL-Safe Encoding**: Converts hashes to URL-safe format for HTTP transport
- **Deduplication**: Identical feeds (same skeleton + inputs) share cache entries

#### Feed Identification

Each feed is uniquely identified by:
```typescript
interface FeedIdentifier {
    start: {
        factReference: FactReference;
        index: number;
    }[];
    skeleton: Skeleton;
}
```

### 4. Skeleton Generation

The [`skeletonOfSpecification()`](src/specification/skeleton.ts:172) function creates an abstract representation of the specification's structure:

```typescript
interface Skeleton {
    facts: FactDescription[];
    inputs: InputDescription[];
    edges: EdgeDescription[];
    notExistsConditions: NotExistsConditionDescription[];
    outputs: OutputDescription[];
}
```

#### Skeleton Components

- **Facts**: Represent fact types and their indices in the query
- **Inputs**: Map given parameters to fact indices
- **Edges**: Define predecessor/successor relationships between facts
- **NotExists Conditions**: Encode negative existential conditions
- **Outputs**: Specify which facts are returned in results

## Data Flow Mechanisms

### 1. Specification Execution

The [`SpecificationRunner`](src/specification/specification-runner.ts:12) executes feeds against a fact source:

```typescript
async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]>
```

#### Execution Pipeline

1. **Match Execution**: Sequentially processes each match clause
2. **Path Traversal**: Follows predecessor/successor relationships
3. **Condition Filtering**: Applies existential conditions
4. **Projection Creation**: Transforms tuples into projected results

### 2. Path Condition Processing

Path conditions define relationships between facts using role-based navigation:

```typescript
interface PathCondition {
    type: "path";
    rolesLeft: Role[];      // Successor navigation
    labelRight: string;     // Target label
    rolesRight: Role[];     // Predecessor navigation
}
```

#### Navigation Patterns

- **Predecessor Navigation**: Follows `rolesRight` from target to ancestors
- **Successor Navigation**: Follows inverted `rolesLeft` from ancestors to descendants
- **Bidirectional Paths**: Combine both navigation types for complex relationships

### 3. Existential Condition Handling

Existential conditions enable complex logical constraints:

```typescript
interface ExistentialCondition {
    type: "existential";
    exists: boolean;        // true for E, false for !E
    matches: Match[];       // Nested specification
}
```

#### Processing Logic

- **Positive Conditions (`E`)**: Include tuples where nested matches succeed
- **Negative Conditions (`!E`)**: Include tuples where nested matches fail
- **Nested Execution**: Recursively execute nested specifications

## Serialization and Communication

### 1. Specification Description

The [`describeSpecification()`](src/specification/description.ts:12) function converts specifications back to human-readable format:

```typescript
function describeSpecification(specification: Specification, depth: number): string
```

#### Format Structure

```
(given1: Type1, given2: Type2) {
    match1: MatchType1 [
        condition1
        condition2
    ]
    match2: MatchType2 [
        condition3
    ]
} => {
    projection1 = { ... }
    projection2 = { ... }
}
```

### 2. Feed Object Structure

Feed objects encapsulate both the specification and its starting parameters:

```typescript
interface FeedObject {
    namedStart: ReferencesByName;
    feed: Specification;
}
```

### 3. Communication Protocol

#### Feed Request Flow

1. **Client**: Sends specification + input facts + bookmark
2. **Server**: Generates feeds using [`buildFeeds()`](src/specification/feed-builder.ts:3)
3. **Server**: Caches feeds using content-based hashing
4. **Server**: Returns distinct tuple members learned after bookmark

#### Subscription Protocol

1. **Client**: Establishes subscription with specification + inputs + bookmark
2. **Server**: Pushes fact references as they arrive
3. **Client**: Updates local bookmark
4. **Client**: Reconnects with last received bookmark after disconnection

## Performance Optimizations

### 1. Feed Decomposition Benefits

- **Incremental Loading**: Load data hierarchically as needed
- **Selective Caching**: Cache frequently accessed feed levels
- **Parallel Execution**: Execute independent feeds concurrently
- **Bandwidth Optimization**: Transfer only required data levels

### 2. Deterministic vs Non-Deterministic Feeds

The system distinguishes between feed types for optimization:

```typescript
function specificationIsNotDeterministic(specification: Specification): boolean
```

- **Deterministic Feeds**: Direct predecessor relationships only
- **Non-Deterministic Feeds**: Include successor relationships or existential conditions
- **Filtering**: Only non-deterministic feeds are included in final feed set

### 3. Specification Splitting

The [`splitBeforeFirstSuccessor()`](src/specification/specification.ts:220) function optimizes execution by separating deterministic and non-deterministic portions:

```typescript
function splitBeforeFirstSuccessor(specification: Specification): {
    head: Specification | undefined;
    tail: Specification | undefined;
}
```

## Error Handling and Validation

### 1. Connectedness Validation

The system ensures all labels in a specification are connected through path relationships, preventing disconnected query fragments.

### 2. Type Safety

- **Label Type Checking**: Ensures role types match connected fact types
- **Reference Validation**: Validates fact references exist before traversal
- **Condition Consistency**: Ensures existential conditions reference valid labels

### 3. Runtime Error Handling

- **Missing Facts**: Graceful handling of missing fact references
- **Type Mismatches**: Clear error messages for type inconsistencies
- **Invalid Paths**: Detection and reporting of invalid relationship paths

## Example Feed Structures

### Simple Parent-Child Relationship

**Input Specification:**
```
(root: Root) {
    child: Child [
        child->root: Root = root
    ]
}
```

**Generated Feed:**
```
(root: Root) {
    child: Child [
        child->root: Root = root
    ]
}
```

### Complex Multi-Level Projection

**Input Specification:**
```
(root: Root) {
    parent: Parent [
        parent->root: Root = root
    ]
} => {
    children = {
        child: Child [
            child->parent: Parent = parent
        ]
    } => {
        grandchildren = {
            grandchild: Grandchild [
                grandchild->child: Child = child
            ]
        }
    }
}
```

**Generated Feeds:**
1. Parent feed: `(root: Root) { parent: Parent [...] }`
2. Child feed: `(root: Root) { parent: Parent [...] child: Child [...] }`
3. Grandchild feed: `(root: Root) { parent: Parent [...] child: Child [...] grandchild: Grandchild [...] }`

### Existential Condition Example

**Input Specification:**
```
(user: User, root: Root) {
    assignment: Assignment [
        assignment->user: User = user
        assignment->project: Project->root: Root = root
        !E {
            revoked: Assignment.Revoked [
                revoked->assignment: Assignment = assignment
            ]
        }
    ]
}
```

**Generated Feeds:**
1. Revocation check feed: `(user: User, root: Root) { assignment: Assignment [...] revoked: Assignment.Revoked [...] }`
2. Active assignment feed: `(user: User, root: Root) { assignment: Assignment [...] !E { revoked: Assignment.Revoked [...] } }`

## Integration Points

### 1. Storage Layer Integration

Feeds integrate with the storage layer through the [`FactSource`](src/specification/specification-runner.ts:5) interface:

```typescript
interface FactSource {
    findFact(reference: FactReference): Promise<FactRecord | null>;
    getPredecessors(reference: FactReference, name: string, predecessorType: string): Promise<FactReference[]>;
    getSuccessors(reference: FactReference, name: string, successorType: string): Promise<FactReference[]>;
    hydrate(reference: FactReference): Promise<unknown>;
}
```

### 2. Network Layer Integration

The feed cache integrates with HTTP transport through URL-safe hash encoding, enabling efficient feed identification in REST APIs.

### 3. Observer Pattern Integration

Feeds support reactive programming patterns through subscription mechanisms, enabling real-time updates as new facts arrive.

## HTTP Wire Protocol

The Jinaga HTTP wire protocol implements a comprehensive communication layer for feed operations, supporting both discrete requests and persistent streaming connections. The protocol is built on standard HTTP/1.1 with custom content types and headers for efficient fact synchronization.

### Protocol Architecture

The HTTP layer consists of three primary components:

1. **[`FetchConnection`](src/http/fetch.ts:13)**: Low-level HTTP transport implementation
2. **[`WebClient`](src/http/web-client.ts:63)**: High-level client API with retry logic
3. **[`HttpNetwork`](src/http/httpNetwork.ts:8)**: Network abstraction for feed operations

### Request-Response Lifecycle

#### Feed Request Flow

**1. Feed Generation Request**
```http
POST /feeds HTTP/1.1
Content-Type: text/plain
Accept: application/json
Authorization: Bearer <token>

let user: Jinaga.User = #<hash>
let root: Root = #<hash>

(user: Jinaga.User, root: Root) {
    assignment: Assignment [
        assignment->user: Jinaga.User = user
        assignment->project: Project->root: Root = root
    ]
}
```

**Response:**
```json
{
    "feeds": [
        "abc123def456...",
        "def456ghi789..."
    ]
}
```

**2. Feed Data Request (Discrete)**
```http
GET /feeds/abc123def456?b=<bookmark> HTTP/1.1
Accept: application/json
Authorization: Bearer <token>
```

**Response:**
```json
{
    "references": [
        {
            "type": "Assignment",
            "hash": "xyz789..."
        }
    ],
    "bookmark": "next_bookmark_value"
}
```

**3. Feed Data Request (Streaming)**
```http
GET /feeds/abc123def456?b=<bookmark> HTTP/1.1
Accept: application/x-jinaga-feed-stream
Authorization: Bearer <token>
```

**Response (Streaming):**
```
HTTP/1.1 200 OK
Content-Type: application/x-jinaga-feed-stream

{"references":[{"type":"Assignment","hash":"xyz789"}],"bookmark":"bookmark1"}
{"references":[{"type":"Task","hash":"abc123"}],"bookmark":"bookmark2"}
```

### HTTP Methods and Endpoints

#### Core Endpoints

| Method | Endpoint | Purpose | Content-Type | Accept |
|--------|----------|---------|--------------|--------|
| `POST` | `/feeds` | Generate feed identifiers | `text/plain` | `application/json` |
| `GET` | `/feeds/{feedId}?b={bookmark}` | Fetch feed data (discrete) | - | `application/json` |
| `GET` | `/feeds/{feedId}?b={bookmark}` | Stream feed data | - | `application/x-jinaga-feed-stream` |
| `POST` | `/load` | Load fact details | `application/json` | `application/json` |
| `POST` | `/save` | Save new facts | `application/json`\|`application/x-jinaga-graph-v1` | `application/json` |
| `GET` | `/login` | Authenticate user | - | `application/json` |
| `OPTIONS` | `/{endpoint}` | Discover content types | - | - |

### Content Types

The protocol supports multiple content types for different operations:

```typescript
const ContentTypeText = "text/plain";           // Specification requests
const ContentTypeJson = "application/json";     // Standard JSON payloads
const ContentTypeGraph = "application/x-jinaga-graph-v1";  // Optimized fact serialization
const ContentTypeFeedStream = "application/x-jinaga-feed-stream";  // Streaming responses
```

### Authentication and Authorization

#### Header Structure

```typescript
interface HttpHeaders {
    "Authorization"?: string;
    [key: string]: string | undefined;
}
```

#### Authentication Flow

1. **Initial Request**: Client sends request with current authentication headers
2. **Authentication Challenge**: Server responds with `401`, `407`, or `419` for auth failures
3. **Reauthentication**: Client calls [`reauthenticate()`](src/http/authenticationProvider.ts:8) method
4. **Retry**: Client retries original request with refreshed headers

```typescript
// Authentication retry logic in FetchConnection.get()
if (response.statusCode === 401 || response.statusCode === 407 || response.statusCode === 419) {
    const retry = await this.reauthenticate();
    if (retry) {
        headers = await this.getHeaders();
        response = await this.httpGet(path, headers);
    }
}
```

### Discrete vs Streaming Operations

#### Discrete Feed Requests ([`get()`](src/http/fetch.ts:20))

**Characteristics:**
- Single request-response cycle
- 30-second timeout with [`AbortController`](src/http/fetch.ts:49)
- JSON response parsing
- Automatic retry on authentication failure
- Suitable for batch operations and initial data loading

**Implementation Pattern:**
```typescript
async get(path: string): Promise<object> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(this.url + path, {
        method: 'GET',
        headers: { 'Accept': ContentTypeJson, ...headers },
        signal: controller.signal
    });
    
    return JSON.parse(await response.text());
}
```

#### Streaming Feed Requests ([`getStream()`](src/http/fetch.ts:96))

**Characteristics:**
- Persistent connection with streaming response
- Line-delimited JSON parsing
- Asynchronous chunk processing
- Graceful connection termination
- Suitable for real-time updates and subscriptions

**Implementation Pattern:**
```typescript
getStream(path: string, onResponse: (response: object) => Promise<void>, onError: (err: Error) => void): () => void {
    const controller = new AbortController();
    
    const response = await fetch(this.url + path, {
        method: 'GET',
        headers: { 'Accept': 'application/x-jinaga-feed-stream', ...headers },
        signal: controller.signal
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    // Recursive chunk reading with line-delimited JSON parsing
    const read = async () => {
        const { done, value } = await reader?.read()!;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        for (const line of lines) {
            if (line.length > 0) {
                await onResponse(JSON.parse(line));
            }
        }
        
        if (!done) read(); // Continue reading
    };
    
    return () => controller.abort(); // Connection termination
}
```

### Bookmark-Based Pagination

#### Bookmark Mechanism

Bookmarks enable incremental data synchronization by tracking the client's last known state:

- **Query Parameter**: Bookmarks are passed as `?b={bookmark}` in feed URLs
- **Response Header**: New bookmark returned in each response
- **State Persistence**: Client maintains bookmark across reconnections
- **Incremental Updates**: Server returns only facts learned after the bookmark

#### Bookmark Flow

```typescript
// Initial request with empty or stored bookmark
const response = await webClient.feed(feedId, lastBookmark);

// Process response and update bookmark
const { references, bookmark: newBookmark } = response;
processReferences(references);
updateStoredBookmark(newBookmark);

// Subsequent requests use updated bookmark
const nextResponse = await webClient.feed(feedId, newBookmark);
```

### Connection Management

#### Timeout Handling

**Discrete Requests:**
- Fixed 30-second timeout for GET requests
- Configurable timeout for POST requests
- [`AbortController`](src/http/fetch.ts:49) for clean cancellation

**Streaming Connections:**
- No explicit timeout (persistent connection)
- Client-controlled termination via returned closure
- Server-side connection management

#### Retry Strategies

**Authentication Retries:**
- Automatic retry on `401`, `407`, `419` status codes
- Single reauthentication attempt per request
- Fail fast on repeated authentication failures

**Network Retries ([`postWithLimitedRetry()`](src/http/web-client.ts:130)):**
- Exponential backoff: 1s, 2s, 4s intervals
- Maximum 4 retry attempts
- Jittered delays to prevent thundering herd
- Timeout doubling on retries (max 60s)

```typescript
private async postWithLimitedRetry(path: string, contentType: PostContentType, accept: PostAccept, body: string) {
    let retrySeconds = 1;
    
    while (true) {
        const response = await this.httpConnection.post(path, contentType, accept, body, this.config.timeoutSeconds);
        
        if (response.result === 'success') return response.response;
        if (response.result === 'failure') throw new Error(response.error);
        
        if (retrySeconds <= 4) {
            await delay(retrySeconds + Math.random()); // Jittered delay
            retrySeconds *= 2;
        } else {
            throw new Error(response.error);
        }
    }
}
```

### Error Handling and Status Codes

#### HTTP Status Code Mapping

| Status Code | Meaning | Action |
|-------------|---------|--------|
| `200` | Success | Process response |
| `201` | Created | Success (empty response) |
| `401` | Unauthorized | Reauthenticate and retry |
| `403` | Forbidden | Fail immediately |
| `407` | Proxy Authentication Required | Reauthenticate and retry |
| `408` | Request Timeout | Map from `AbortError` |
| `419` | Authentication Timeout | Reauthenticate and retry |
| `4xx` | Client Error | Retry (if retryable) |
| `5xx` | Server Error | Retry with backoff |

#### Error Response Handling

```typescript
// Status code classification
if (response.statusCode === 403) {
    throw new Error(response.statusMessage); // Fail fast
}
else if (response.statusCode >= 400) {
    return { result: "retry", error: response.statusMessage }; // Retryable
}
```

### Message Formats

#### Feed Request Format

**Specification Request Body:**
```
let user: Jinaga.User = #7sBapqyHpC+fbF1yeARDNSV0kLNwPt2J1+O9bpybYuw=
let root: Root = #abc123def456...

(user: Jinaga.User, root: Root) {
    assignment: Assignment [
        assignment->user: Jinaga.User = user
        assignment->project: Project->root: Root = root
        !E {
            revoked: Assignment.Revoked [
                revoked->assignment: Assignment = assignment
            ]
        }
    ]
} => {
    tasks = {
        task: Task [
            task->assignment: Assignment = assignment
        ]
    }
}
```

#### Response Formats

**Feed Generation Response:**
```typescript
interface FeedsResponse {
    feeds: string[];  // Array of feed identifiers (hashes)
}
```

**Feed Data Response:**
```typescript
interface FeedResponse {
    references: FactReference[];  // Array of fact references
    bookmark: string;             // Next bookmark for pagination
}
```

**Fact Loading Response:**
```typescript
interface LoadResponse {
    facts: FactRecord[];  // Complete fact objects with fields
}
```

### Performance Optimizations

#### Connection Pooling

The protocol leverages browser's built-in HTTP connection pooling:
- Persistent connections for multiple requests to same origin
- HTTP/1.1 keep-alive for connection reuse
- Browser-managed connection limits and timeouts

#### Content Negotiation

**Dynamic Content Type Selection:**
```typescript
// Server capability discovery
const acceptedTypes = await httpConnection.getAcceptedContentTypes('/save');

// Optimal format selection
if (acceptedTypes.includes(ContentTypeGraph)) {
    await post('/save', ContentTypeGraph, undefined, serializeGraph(envelopes));
} else {
    await post('/save', ContentTypeJson, ContentTypeJson, JSON.stringify(envelopes));
}
```

#### Streaming Optimizations

- **Line-buffered parsing**: Processes complete JSON objects as they arrive
- **Incremental decoding**: Uses [`TextDecoder`](src/http/fetch.ts:126) with streaming mode
- **Backpressure handling**: Async response processing prevents buffer overflow

### Integration with Feed Architecture

#### Specification to HTTP Mapping

```typescript
// HttpNetwork.feeds() - Convert specification to HTTP request
async feeds(start: FactReference[], specification: Specification): Promise<string[]> {
    const declarationString = describeDeclaration(start, specification.given);
    const specificationString = describeSpecification(specification, 0);
    const request = `${declarationString}\n${specificationString}`;
    
    const response: FeedsResponse = await this.webClient.feeds(request);
    return response.feeds; // Feed identifiers for subsequent requests
}
```

#### Feed Execution Flow

1. **Specification Submission**: Client sends specification + starting facts
2. **Feed Generation**: Server generates feed identifiers using [`buildFeeds()`](src/specification/feed-builder.ts:3)
3. **Feed Caching**: Server caches feeds with content-based hashing
4. **Feed Retrieval**: Client requests specific feeds with bookmarks
5. **Incremental Updates**: Server returns facts learned after bookmark
6. **Bookmark Advancement**: Client updates bookmark for next request

## Conclusion

The Jinaga feed architecture provides a sophisticated yet efficient system for transforming declarative specifications into optimized data feeds. Through hierarchical decomposition, content-based caching, and intelligent execution strategies, it enables scalable fact synchronization while maintaining the simplicity of declarative queries.

The HTTP wire protocol complements this architecture with robust communication patterns, supporting both discrete and streaming operations, comprehensive error handling, and efficient bookmark-based pagination. The protocol's design enables reliable fact synchronization across unreliable networks while maintaining real-time capabilities through persistent streaming connections.

The system's design supports both batch and real-time scenarios, making it suitable for a wide range of distributed applications requiring consistent, incremental data synchronization.