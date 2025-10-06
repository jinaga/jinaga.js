# StreamFeed Sequence Diagram

## Description

The `streamFeed` function in the Jinaga.js library establishes a persistent HTTP connection to stream feed data from a server. This process involves multiple layers of abstraction: `HttpNetwork`, `WebClient`, and `FetchConnection`.

### Process Overview

1. **Initiation**: The caller invokes `HttpNetwork.streamFeed(feedRefreshIntervalSeconds)`, which wraps the response callback to extract `factReferences` and `nextBookmark` from the `FeedResponse`.

2. **Delegation**: `HttpNetwork` delegates to `WebClient.streamFeed()`, which further delegates to `FetchConnection.getStream(feedRefreshIntervalSeconds)`.

3. **Connection Establishment with Retry**: `FetchConnection` asynchronously:
   - Retrieves authentication headers
   - Makes a GET request to `/feeds/{feed}?b={bookmark}` with `Accept: application/x-jinaga-feed-stream`
   - If the fetch fails, retries with exponential backoff and jitter, maximizing delay at `feedRefreshIntervalSeconds`, continuing until aborted
   - Receives a streaming HTTP response

4. **Streaming Setup**: The response body is accessed as a `ReadableStream`, and a `TextDecoder` is used to process incoming data chunks.

5. **Data Processing**: A recursive `read()` function processes the stream:
   - Reads chunks from the stream
   - Decodes and buffers the data
   - Splits the buffer by newlines
   - Parses each non-empty line as JSON (`FeedResponse`)
   - Calls the `onResponse` callback for each parsed response

6. **Persistence**: The HTTP connection remains open, allowing the server to continuously send data. The client processes data asynchronously without blocking.

7. **Cancellation**: A cancel function is returned, which aborts the fetch request and stops processing when called.

8. **Error Handling**: Errors during initial connection establishment are retried automatically. Any errors during reading or parsing are propagated through the `onError` callback chain.

This design enables real-time streaming of feed updates over a single persistent HTTP connection, efficient for scenarios requiring continuous data flow.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Caller
    participant HttpNetwork
    participant WebClient
    participant FetchConnection
    participant Server

    Note over Caller,Server: streamFeed Flow: Persistent HTTP Connection for Streaming Feed Data with Retry

    Caller->>HttpNetwork: streamFeed(feed, bookmark, onResponse, onError, feedRefreshIntervalSeconds)
    activate HttpNetwork
    HttpNetwork->>WebClient: streamFeed(feed, bookmark, async (response) => onResponse(response.references, response.bookmark), onError, feedRefreshIntervalSeconds)
    activate WebClient
    WebClient->>FetchConnection: getStream(`/feeds/${feed}?b=${bookmark}`, (r) => onResponse(r as FeedResponse), onError, feedRefreshIntervalSeconds)
    activate FetchConnection

    loop Retry Loop with Exponential Backoff
        FetchConnection->>FetchConnection: await getHeaders()
        FetchConnection->>Server: fetch(url + path, { method: 'GET', headers: { Accept: 'application/x-jinaga-feed-stream', ...headers }, signal })
        activate Server
        alt fetch succeeds
            Server-->>FetchConnection: Response (status 200, body stream)
            deactivate Server
        else fetch fails
            Server-->>FetchConnection: Error response or network failure
            deactivate Server
            FetchConnection->>FetchConnection: Calculate delay with exponential backoff + jitter, cap at feedRefreshIntervalSeconds
            FetchConnection->>FetchConnection: await delay
        end
    end

    FetchConnection->>FetchConnection: const reader = response.body.getReader()
    FetchConnection->>FetchConnection: const decoder = new TextDecoder()
    FetchConnection->>FetchConnection: let buffer = ''
    FetchConnection->>FetchConnection: Define recursive read() function
    FetchConnection->>FetchConnection: read() // start reading

    FetchConnection-->>WebClient: return () => { closed = true controller.abort() }
    deactivate FetchConnection
    WebClient-->>HttpNetwork: return cancel function
    deactivate WebClient
    HttpNetwork-->>Caller: return cancel function
    deactivate HttpNetwork

    loop Asynchronous Streaming Loop
        FetchConnection->>FetchConnection: await reader.read()
        alt done
            FetchConnection->>FetchConnection: return (end of stream)
        else value received
            FetchConnection->>FetchConnection: buffer += decoder.decode(value, { stream: true })
            FetchConnection->>FetchConnection: const lastNewline = buffer.lastIndexOf('\n')
            alt lastNewline >= 0
                FetchConnection->>FetchConnection: const jsonText = buffer.substring(0, lastNewline)
                FetchConnection->>FetchConnection: buffer = buffer.substring(lastNewline + 1)
                FetchConnection->>FetchConnection: const lines = jsonText.split(/\r?\n/)
                loop for each line
                    alt line.length > 0
                        FetchConnection->>FetchConnection: const json = JSON.parse(line)
                        FetchConnection->>WebClient: onResponse(json as FeedResponse)
                        activate WebClient
                        WebClient->>HttpNetwork: onResponse(response)
                        activate HttpNetwork
                        HttpNetwork->>Caller: onResponse(factReferences, nextBookmark)
                        deactivate HttpNetwork
                        deactivate WebClient
                    end
                end
            end
            FetchConnection->>FetchConnection: read() // recurse
        end
    end

    Note over Caller,Server: On fetch error: retries with exponential backoff until success or abort
    Note over Caller,Server: On streaming error: reader.read() or JSON.parse fails -> onError(err) up the chain
    Note over Caller,Server: To cancel: Call returned function -> controller.abort() -> stops fetch, reading, and retries
```

## Error Scenarios

### Fetch Request Failures

If the initial HTTP fetch request fails (e.g., due to network connectivity issues, server unavailability, or HTTP errors), the following occurs:

1. The `fetch` request throws an exception or returns a non-OK response.
2. Instead of immediately calling `onError`, `FetchConnection` calculates a retry delay using exponential backoff with jitter.
3. The delay starts at 1 second and doubles with each attempt, capped at `feedRefreshIntervalSeconds`.
4. After the delay, the fetch is retried.
5. This continues indefinitely until either the fetch succeeds or `controller.abort()` is called.
6. Once the fetch succeeds, normal streaming begins.

### Connection Closed During Streaming (net::ERR_CONNECTION_CLOSED with 200 OK)

If the HTTP connection is closed unexpectedly after the initial 200 OK response (e.g., due to network issues, server restart, or timeout), the following occurs:

1. The `fetch` request succeeds and returns a 200 OK response with a streaming body.
2. During the asynchronous reading loop, `reader.read()` throws an error (e.g., `net::ERR_CONNECTION_CLOSED` in Chrome).
3. This error is caught in the `catch` block of the `read()` function.
4. `onError(err)` is called, propagating the error up the chain: `FetchConnection` → `WebClient` → `HttpNetwork` → `Caller`.
5. The streaming stops, and no further data is processed.
6. The connection cannot be automatically re-established; the caller must handle the error and potentially restart the stream if desired.
```