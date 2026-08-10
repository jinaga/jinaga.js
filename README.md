# Jinaga

End-to-end application state management framework.

Add Jinaga.JS to a client app and point it at a Replicator.
Updates are sent to the Replicator as the user works with the app.
Any changes that the app needs are pulled from the Replicator.

## Install

Install Jinaga.JS from the NPM package.

```bash
npm i jinaga
```

This installs just the client side components.
See [jinaga.com](https://jinaga.com) for details on how to use them.

## Running a Replicator

A Jinaga front end connects to a device called a Replicator.
The Jinaga Replicator is a single machine in a network.
It stores and shares facts.
To get started, create a Replicator of your very own using [Docker](https://www.docker.com/products/docker-desktop/).

```
docker pull jinaga/jinaga-replicator
docker run --name my-replicator -p8080:8080 jinaga/jinaga-replicator
```

This creates and starts a new container called `my-replicator`.
The container is listening at port 8080 for commands.
Configure Jinaga to use the replicator:

```typescript
import { JinagaBrowser } from "jinaga";

export const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});
```

## Breaking Changes

If you are upgrading from an older version, you may need to update your code.

### `query()` now throws when a given fact is missing locally

A one-shot `j.query()` now throws a typed `GivenNotFoundError` when one of its
given facts is not in the local store *and* nothing could have supplied it —
no replicator is configured, as with `JinagaTest` or a `JinagaBrowser` without
an HTTP endpoint. Previously the query returned an empty array, which was
indistinguishable from a specification that legitimately matched nothing.

This matters most with `j.factReference(Type, hash)`, which builds a given
from a bare hash. A hash that was purged, evicted, never fetched, or simply
wrong used to read back as "no results".

The error names every reference that was missing:

```typescript
try {
    const posts = await j.query(postsInBlog, j.factReference(Blog, hash));
} catch (e) {
    if (e instanceof GivenNotFoundError) {
        console.log(e.references); // [{ type: 'Blog', hash: '...' }]
    }
}
```

Unchanged: when a replicator *was* consulted, nothing is thrown. It evaluated
the specification from the given and reported what matches, and that answer
holds whether or not the given is resident locally. A given that exists but is
excluded by a given condition is also unchanged — that is a real answer of
zero rows, not a failed read.

`watch()` and `subscribe()` never throw for this. A subscription has a "later"
in which the fact may arrive, so the condition is reported on the diagnostic
channel instead and clears itself once results flow.

To upgrade:
- Save the fact before querying from it, or
- Catch `GivenNotFoundError`, or
- Switch to `queryWithDiagnostics()`, which never throws and returns the
  condition as a diagnostic.

### Diagnostics are now a discriminated union

`queryWithDiagnostics()`, `onDistributionDiagnostic()`, and
`Observer.diagnostics()` now carry `ReadDiagnostic`, a union of the existing
per-feed `DistributionDiagnostic` and the new `GivenNotFoundDiagnostic`. Both
variants carry a required `kind` discriminant.

To upgrade, narrow before reading variant-specific fields:

```typescript
j.onDistributionDiagnostic(d => {
    if (d.kind === 'distribution' && d.reactive) {
        // the subscription race; never fatal
    }
});
```

### `Network` implementations must declare `canLoad`

Custom `Network` implementations must now declare `readonly canLoad: boolean` —
whether `load()` can return facts that are not already in the local store. This
is what tells the library whether an absent given is terminal or merely
pending. Set it to `true` for anything backed by a replicator.

### `query()` now throws on structural distribution denials

A one-shot `j.query()` now throws a typed `DistributionDeniedError` when the
specification is denied by a *structural* distribution cause — no rule covers
the feed (`no-matching-rule`), or the spec is narrower than its rule
(`spec-more-restrictive-than-rule`). Previously the denial was silent and
`query()` returned an empty array (except in development mode).

This makes a mis-authored spec or distribution rule observable at the call
site instead of masquerading as "no matching data". A one-shot query has no
"later" to wait for, unlike `j.subscribe()`, whose feed stays open and
self-heals when the authorizing fact arrives.

Unchanged: `reactive` decisions (the subscription race) and non-structural
denials (`principal-excluded`, `not-authenticated`) still return an empty
result without throwing.

To upgrade:
- Wrap one-shot `query()` calls that can be denied in a `try`/`catch` for
  `DistributionDeniedError`, or
- Switch to `queryWithDiagnostics()`, which never throws and returns the
  distribution diagnostics alongside the results.

The `developmentMode` flag on `JinagaBrowser` no longer affects this — it only
installs the console diagnostic handler. The `Jinaga` constructor no longer
accepts a `developmentMode` parameter.

### Changes in version 4.0.0

In version 4.0.0, the server side code has been moved to a separate package.
This allows you to build a client using Create React App and connect it to a Replicator.

When upgrading, take the following steps:
- Install the `jinaga-server` package.
- Remove the 'jinaga' alias from 'webpack.config.js'.
- Import `JinagaServer` from 'jinaga-server'.
- Rename any references of `Specification<T>` to `SpecificationOf<T>`, and `Condition<T>` to `ConditionOf<T>`. These are used as return types of specification functions. It is uncommon to be explicit about them.

### Changes in version 3.1.0

The name of the client-side script changed from `jinaga.js` to `jinaga-client.js`.
In `webpack.config.js`, update the `jinaga` alias from `jinaga/dist/jinaga` to `jinaga/dist/jinaga-client`.

### Changes in version 3.0.0

In version 3 of Jinaga.JS, the `has` function takes two parameters.
The second is the name of the predecessor type.
In version 2, the function took only one parameter: the field name.

To upgrade, change this:

```javascript
function assignmentUser(assignment) {
  ensure(assignment).has("user");
  return j.match(assignment.user);
}
```

To this:

```javascript
function assignmentUser(assignment) {
  ensure(assignment).has("user", "Jinaga.User");
  return j.match(assignment.user);
}
```

## Build

To build Jinaga.JS, you will need Node 16.

```bash
npm ci
npm run build
npm test
```

## Release

To release a new version of Jinaga.JS, bump the version number, create and push a tag,
and create a release. The GitHub Actions workflow will build and publish the package.

```bash
git c main
git pull
npm version patch
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes --verify-tag
```