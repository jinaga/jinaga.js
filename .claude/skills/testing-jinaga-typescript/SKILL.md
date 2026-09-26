---
name: testing-jinaga-typescript
description: >
  Use when writing or editing a test for a Jinaga fact type, specification,
  or authorization/distribution rule in TypeScript.
---

# Testing Jinaga in TypeScript

Test against `JinagaTest.create(...)`, an in-memory client — not a mock of
`Jinaga` itself. The real save/query/watch behavior (hashing, existential
filtering, authorization, distribution) is exactly what a test needs to
exercise, and a hand-rolled mock tends to quietly assert the test author's
assumptions rather than the library's real behavior.

## Basic shape

```typescript
import { JinagaTest, User } from "jinaga";
import { model, Project, Task, TaskTitle, currentTitle } from "./model";

const j = JinagaTest.create({ model });
const user = new User("--- test user ---");
const project = await j.fact(new Project(user, new Date()));
const task = await j.fact(new Task(project, new Date()));

await j.fact(new TaskTitle(task, "Draft outline", []));
const titles = await j.query(currentTitle, task);
expect(titles).toEqual(["Draft outline"]);
```

`JinagaTest.create` also accepts `authorization`, `distribution`, `user`
(the identity the client acts as), `device`, and `initialState` (an array
of facts saved directly into the store, bypassing authorization — useful
for seeding facts the test isn't itself trying to prove get created).

## Test authorization and distribution, not just the happy path

Authorization and distribution are both easy to get subtly wrong (see
`authoring-authorization-distribution-typescript`), and both fail in ways a
test needs to assert on directly:

```typescript
const authorization = (a: AuthorizationRules) => a
    .any(User)
    .type(Project, project => project.creator);

it("rejects a project authored on behalf of someone else", async () => {
    const creator = new User("--- creator ---");
    const impersonator = new User("--- impersonator ---");
    const j = JinagaTest.create({ model, authorization, user: impersonator });
    await expect(j.fact(new Project(creator, new Date()))).rejects.toThrow();
});

it("rejects a query from a user the share rule doesn't cover", async () => {
    const owner = new User("--- owner ---");
    const stranger = new User("--- stranger ---");
    const j = JinagaTest.create({
        model, authorization, distribution,
        user: stranger,
        initialState: [owner, new Project(owner, new Date())],
    });
    await expect(j.query(projectsByUser, owner)).rejects.toThrow();
});
```

Seed the *other* party's facts via `initialState`, not by authoring them as
the test's own user — `initialState` bypasses authorization, so it can hold
facts the test's own identity isn't allowed to create. A component's
reactive `useSpecification` read never proves a distribution denial the way
a direct `j.query()` rejection does — see `integrating-jinaga-react`.

## Compare facts by hash, never by reference

A query returns freshly-constructed objects, not the instances that were
saved — `titles[0] === savedTitle` is always false even for "the same"
fact. Compare with `Jinaga.hash(a) === Jinaga.hash(b)` (a static method,
imported from `jinaga` — not an instance method on the client), or assert
on the projected field values directly rather than the fact instance.

## Reconstruction tests rebuild the key, they don't reuse the seed instance

For a reconstructable-key fact (see `authoring-jinaga-facts-typescript`),
resolve it in the test by building a *fresh* instance from the same known
inputs, not by holding onto the object the test created it with — otherwise
the test can't actually distinguish "this fact is reconstructable" from
"this fact happens to still be in scope":

```typescript
const found = await j.query(byInvitationCode, new InvitationCode(tenant, "X4B2"));
```
