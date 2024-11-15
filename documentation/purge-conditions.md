# Purge Conditions

A Jinaga replica is an immutable database.
It typically does not allow for updates or deletions.

However, there is a way to purge data from a replica.
If you can prove that the data will have no effect on the results of any specification, then the runtime will purge it.
Purge conditions are how you provide that proof.

## Example: Contact List

Declare purge conditions when defining a model.
For example, consider a model that describes a contact list.

A list belongs to a user.
A list contains contacts.
A contact has a name and an email address.

```typescript
export class List {
  static Type = "CRM.List" as const;
  type = CRM.Type;

  constructor(
    public owner: User,
    public uuid: string
  ) { }
}

export class Contact {
  static Type = "CRM.Contact" as const;
  type = CRM.Type;

  constructor(
    public list: List,
    public createdAt: Date | string
  ) { }
}

export class Name {
  static Type = "CRM.Contact.Name" as const;
  type = CRM.Type;

  constructor(
    public contact: Contact,
    public value: string,
    public prior: Name[]
  ) { }
}

export class Email {
  static Type = "CRM.Contact.Email" as const;
  type = CRM.Type;

  constructor(
    public contact: Contact,
    public value: string,
    public prior: Email[]
  ) { }
}
```

Suppose we wanted to delete a contact from the list.
We could express that as a `Contact.Deleted` fact.

```typescript
export class ContactDeleted {
  static Type = "CRM.Contact.Deleted" as const;
  type = CRM.Type;

  constructor(
    public contact: Contact
  ) { }
}
```

### Build a Model

With all of the fact types defined, we can build a model that lets us write specifications.

```typescript
const model = buildModel(m => m
    .type(List, x => x
        .predecessor("owner", User)
    )
    .type(Contact, x => x
        .predecessor("list", List)
    )
    .type(ContactDeleted, x => x
        .predecessor("contact", Contact)
    )
    .type(Name, x => x
        .predecessor("contact", Contact)
        .predecessor("prior", Name)
    )
    .type(Email, x => x
        .predecessor("contact", Contact)
        .predecessor("prior", Email)
    )
);
```

### Write a Specification

To show all of the contacts in a list, we would write a specification.

```typescript
const contactsInList = model.given(List).match((list, facts) =>
    facts.ofType(Contact)
        .join(contact => contact.list, list)
        .notExists(contact =>
            facts.ofType(ContactDeleted)
                .join(contactDeleted => contactDeleted.contact, contact))
        .select(contact => ({
            contact,
            name: facts.ofType(Name)
                .join(name => name.contact, contact)
                .notExists(name =>
                    facts.ofType(Name)
                        .join(next => next.prior, name)
                )
                .select(name => name.value),
            email: facts.ofType(Email)
                .join(email => email.contact, contact)
                .notExists(email =>
                    facts.ofType(Email)
                        .join(next => next.prior, email)
                )
                .select(email => email.value)
        }));
);
```

Notice how the specification excludes contacts that have been deleted.
If all specifications did so, then we could safely purge information about deleted contacts from the replica.

### Declare Purge Conditions

To declare purge conditions, write a function that takes a `PurgeConditions` object and adds conditions to it.

```typescript
const purgeConditions = (p: PurgeConditions) => p
    .whenExists(model.given(Contact).match((contact, facts) =>
        facts.ofType(ContactDeleted)
            .join(contactDeleted => contactDeleted.contact, contact)
    ));
```

Use that function when initializing the Jinaga client.

```typescript
const j = JinagaClient.create({
    purgeConditions
});
```

The effect of this declaration is that when the application uses this jinaga client to query, watch, or subscribe to a specification, the runtime will verify that the purge conditions are included.
If a specification matches a `Contact` and does not include `notExists` for `ContactDeleted`, then the runtime will throw an exception.
This proves that no specification will return information about a deleted contact.

### Purge the Data

To purge the data, call the `purge` method on the Jinaga client.

```typescript
await j.purge();
```

This will remove all successors of `Contact` facts when a `ContactDeleted` fact exists for that contact.
The runtime must keep the `Contact` and the `ContactDeleted` facts to ensure that the replica doesn't later learn about the deleted contact.
But it can remove the `Name` and `Email` facts for that contact.