# Querying for `successors`

As an alternative to the `join` method, you can use the `successors` method to query for facts that are successors of a given fact.
Rather than joining to `facts.ofType(T)`, you can find `successors(T, ...)` directly.

When using `successors`, it is often possible to remove the `facts` parameter from the match function.

## Example of Using the `successors` Method

In the context of a company model, you can use the `successors` method to find all offices of a company by specifying the relationship between the company and its offices. Here is an example:

```typescript
const specification = model.given(Company).match(company =>
    company.successors(Office, office => office.company)
);

const result = await j.query(specification, company);
```

In this example, the `successors` method is used to find all offices of a company by specifying the relationship between the company and its offices.

## Compared to the `join` Method

The alternative to the `successors` syntax in Jinaga is to use the `join` method.
Here is that same query expressed using the `join` method:

```typescript
const specification = model.given(Company).match((company, facts) =>
    facts.ofType(Office)
        .join(office => office.company, company)
);

const result = await j.query(specification, company);
```

Notice that we need to pass the `facts` parameter to the match function when using the `join` method.
Then we use `facts.ofType(Office)` to find all offices of the company, and `join` to specify the relationship between the company and its offices.

## Using the `successors` Method with Composite Projections

Composite projections allow you to define a structure for the results of a query.
You can define nested projections and collections.
The `successors` method can be used within composite projections.
Here is an example:

```typescript
const specification = model.given(Company).match(company =>
    company.successors(Office, office => office.company)
        .select(office => ({
            identifier: office.identifier,
            employees: office.successors(Employee, employee => employee.office)
        }))
);

const result = await j.query(specification, company);
```

In this example, the `successors` method is used to find all offices of a company and include additional information about each office, such as its employees, in the projection.
