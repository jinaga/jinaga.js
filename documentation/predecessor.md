# Querying for `predecessor`

The `predecessor()` method allows you to navigate from a fact to its direct predecessor in a specification. This provides a convenient way to traverse relationships in the reverse direction.

## Example of Using the `predecessor` Method

In the context of a company model, you can use the `predecessor()` method to find the company that an office belongs to:

```typescript
const specification = model.given(Office).match(office =>
    office.company.predecessor()
);

const result = await j.query(specification, office);
```

In this example, the `predecessor()` method is used to navigate from an office to its company.

## Compared to the `join` Method

The alternative to the `predecessor()` syntax in Jinaga is to use the `join` method with `facts.ofType()`:

```typescript
const specification = model.given(Office).match((office, facts) =>
    facts.ofType(Company)
        .join(company => company, office.company)
);

const result = await j.query(specification, office);
```

The `predecessor()` method provides a more concise and readable way to express the same query.

## Using the `predecessor` Method with Projections

You can use the `predecessor()` method with projections to select specific fields or create composite results:

```typescript
const specification = model.given(Office).match(office =>
    office.company.predecessor()
        .select(company => company.identifier)
);

const result = await j.query(specification, office);
```

For composite projections that include predecessor relationships, you need to properly label the predecessor facts:

```typescript
const specification = model.given(Office).match((office, facts) =>
    office.company.predecessor()
        .select(company => ({
            identifier: company.identifier,
            creator: facts.ofType(User)
                .join(user => user, company.creator)
        }))
);

const result = await j.query(specification, office);
```

## Chaining Predecessor Calls

You can chain multiple `predecessor()` calls to navigate through multiple levels of relationships:

```typescript
const specification = model.given(President).match(president =>
    president.office.company.predecessor()
);

const result = await j.query(specification, president);
```

This example navigates from a president to their office, and then to the company of that office.

## Combining with Existential Conditions

The `predecessor()` method can be used with existential conditions:

```typescript
const specification = model.given(OfficeClosed).match(officeClosed =>
    officeClosed.office.predecessor()
        .exists(office => office.company.predecessor())
);

const result = await j.query(specification, officeClosed);
```

## Combining with Successors

You can combine `predecessor()` and `successors()` methods in the same query:

```typescript
const specification = model.given(Company).match(company =>
    company.successors(Office, office => office.company)
        .select(office => ({
            identifier: office.identifier,
            presidents: office.successors(President, president => president.office)
                .selectMany(president => president.user.predecessor()
                    .select(user => ({
                        user: user,
                        names: user.successors(UserName, userName => userName.user)
                            .select(userName => userName.value)
                    }))
                )
        }))
);

const result = await j.query(specification, company);
```

This example shows how to navigate from a company to its offices (using `successors`), then to the presidents of those offices (using `successors`), then to the users who are those presidents (using `predecessor`), and finally to the names of those users (using `successors`).
