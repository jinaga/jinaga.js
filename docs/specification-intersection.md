# Specification Intersection

The goal of specification intersection is to produce a specification that produces tuples only when the distribution condition is satisfied.

## Procedure

To compute the intersection, add a new distribution user given. Then attach a condition to that user given based on the distribution condition.

The condition is an existential condition containing the distribution rule. Add a new path condition to the user fact that is projected from the distribution rule. That new path condition equates the projected user with the distribution user.

## Intended Use

In `DistributionEngine`, a new method called `intersectDistributionRules` will find all feeds of the input specification. It will then find all distribution rules matching those skeletons. For each matching distribution rule, it will compute the intersection with the feed, and then compute the feeds of that resulting specification. The method will return all distinct feeds.

With this in place, the `HttpRouter` will call `intersectDistributionRules` on the injected distribution engine in the `feeds` endpoint. It will add these feeds to the feed cache including the request user as the distribution user given.

The call to `canDistributeToAll` will be removed from the `feed` endpoint. Instead, the endpoint will verify that the request user matches the distribution user of the cached feed. If not, it throws Forbidden.

The result of this is that the Forbidden error will no longer be thrown during the execution of the `feeds` endpoint. Instead, all feeds will include the distribution condition. Each user will receive their own unique feeds. And the `feed` endpoint will ensure that users cannot access other users' feeds.

## Example

Share specification A - tasks of reader's project:

```factual
(p1: Test.Reader) {
    u1: Test.Task [
        u1->project: Test.Project = p1->project: Test.Project
    ]
} => u1
```

With specification B - user of the reader:

```factual
(p1: Test.Reader) {
    u1: Jinaga.User [
        u1 = p1->user: Jinaga.User
    ]
} => u1
```

The intersection of the two specifications is:

```factual
(p1: Test.Reader, distributionUser: Jinaga.User [
    E {
        u2: Jinaga.User [
            u2 = p1->user: Jinaga.User
            u2 = distributionUser
        ]
    }
]) {
    u1: Test.Task [
        u1->project: Test.Project = p1->project: Test.Project
    ]
} => u1
```
