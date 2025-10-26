# Contributing

I have a vision for historical modeling, but I need your help to realize this vision in JavaScript. Here are some of the ways you can help.

## Building

Clone the repository and build the code. You will need to:

Once:

- Install [node](https://nodejs.org/)

Each time you pull:

- Run `npm ci`

As you work:

- Run `npm run test:watch` to compile and run the tests during development

## Testing

Follow the instructions on [jinaga.com](https://jinaga.com) to create a new app.
Let me know what issues you find.
Open [issues](https://github.com/jinaga/jinaga/issues) in this repository.

### Writing Tests

When writing tests for Jinaga, follow these guidelines to avoid flaky tests:

#### Avoid Arbitrary Timeouts

**Don't** use arbitrary timeouts like `setTimeout(resolve, 50)` to wait for async operations:

```typescript
// ❌ BAD: Flaky and slow
await j.fact(someFact);
await new Promise(resolve => setTimeout(resolve, 50));
expect(callbacks.length).toBe(1);
```

**Do** use `observer.processed()` to wait for notifications to complete:

```typescript
// ✅ GOOD: Deterministic and fast
await j.fact(someFact);
await observer.processed();
expect(callbacks.length).toBe(1);
```

#### Using Observer.processed()

The `observer.processed()` method returns a promise that resolves when all pending notifications have been processed. This includes:
- All observer callbacks triggered by facts that have been added
- Nested observer callbacks from specifications with nested components
- Buffered notifications that are replayed when handlers register late

```typescript
const observer = j.watch(specification, given, projection => {
    // Your callback logic
});

// Add facts
await j.fact(fact1);
await j.fact(fact2);

// Wait for all notifications to complete
await observer.processed();

// Now you can safely assert on the results
expect(results).toEqual(expectedResults);
```

#### Test Utilities

Use the utilities in `test/utils/async-test-utils.ts` for common testing patterns:

```typescript
import { waitForObserver, waitForCondition, waitForCallbackCount } from '../utils/async-test-utils';

// Wait for observer to complete
await waitForObserver(observer);

// Wait for a specific condition
await waitForCondition(() => callbacks.length > 0);

// Wait for a specific number of callbacks
await waitForCallbackCount(() => callbacks.length, 5);
```

#### When Timeouts Are Acceptable

Timeouts are acceptable in these specific cases:

1. **Testing race conditions**: When you deliberately want to test timing-sensitive behavior
2. **Polling external systems**: When waiting for external state changes that don't have event notifications
3. **Simulating user delays**: When testing buffering mechanisms that handle delayed handler registration

In these cases, document why the timeout is necessary:

```typescript
// This test specifically tests the buffering mechanism when handlers
// register after facts arrive, so setTimeout is intentional
setTimeout(() => {
    projection.managers.onAdded(handler);
}, 0);
```

## Recommendations

Create [issues](https://github.com/jinaga/jinaga/issues) for anything you would like to see changed. We will discuss it in the public arena. Keep in mind, however, that recommendations for changes are to be defended. Be prepared to provide evidence that it makes the system more resilient, more secure, or easier to use. Personal preference is not evidence.

## Sending pull requests

Before making large changes, please let me know what you are working on. Comment on an issue, or open a new one.

Clone the repository in GitHub. Create a branch. Make your changes. Submit a pull request from your working branch against master.

If you prefer some other repository host, please open an issue and paste in your git URL and working branch name.

## Asking questions

Reach out to me on Twitter [@michaellperry](https://twitter.com/michaellperry). Ask me about the library in particular, or historical modeling in general. 

## Spreading the word

When you talk about the project, you can send people to http://jinaga.com. That will take them to this repository until I create a home page for the library. Then it will take them to documentation on getting started and a reference manual.

When you talk about historical modeling in general, you can send people to https://immutablearchitecture.com. The book The Art of Immutable Architecture describes the principles of building distributed systems using immutable data structures. Jinaga is a realization of those principles.