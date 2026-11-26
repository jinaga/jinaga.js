import { Specification } from "../../src/specification/specification";
import { SpecificationParser } from "../../src/specification/specification-parser";
import * as correlated from "./models/correlated-not-exists";
import * as intermediate from "./models/intermediate-projection";
import * as nested from "./models/nested-not-exists";
import * as minimalPredecessor from "./models/predecessor-not-exists-minimal";
import * as productionPredecessor from "./models/predecessor-not-exists-production";
import * as positive from "./models/positive-existential-branch";
import * as sibling from "./models/sibling-condition";

/**
 * Every fixed specification whose feeds this library's own spec files exercise.
 *
 * `buildFeeds` and `skeletonOfSpecification` are the reference for a port
 * (jinaga/jinaga.net#201), and the replicator compares the skeletons this
 * implementation computes, so a port's expectations have to be *derived* from
 * this implementation rather than transcribed from it (#387). This list is the
 * generating set: `test/vectors/generate.ts` runs the two functions over it and
 * emits the result as JSON, and the spec files take their inputs from here, so
 * each input is written once.
 *
 * Specifications drawn from a seeded generator stay in their own spec files:
 * they keep generating their inputs and need no case here.
 *
 * A case is written in the text grammar where the spec file writes it that way,
 * and with the model builder where the spec file builds it that way. The vector
 * carries `describeSpecification` text either way.
 */

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

// ---------------------------------------------------------------------------
// feedBuilderSpec.ts
// ---------------------------------------------------------------------------

export const identity = parse(`
    (root: Root) { }`);

export const simpleSuccessor = parse(`
    (root: Root) {
        child: Child [
            child->root:Root = root
        ]
    }`);

export const projectionOfIdentity = parse(`
    (root: Root) {} => {
        children = {
            child: Child [
                child->root:Root = root
            ]
        }
    }`);

export const projectionWithTwoProperties = parse(`
    (root: Root) {
    } => {
        children1 = {
            c1: Child1 [
                c1->root: Root = root
            ]
        }
        children2 = {
            c2: Child2 [
                c2->root: Root = root
            ]
        }
    }`);

export const twoGivens = parse(`
    (user: Jinaga.User, root: Root) {
        assignment: MyApp.Assignment [
            assignment->user:Jinaga.User = user
            assignment->project:MyApp.Project->root:Root = root
        ]
    }`);

export const negativeExistentialCondition = parse(`
    (user: Jinaga.User, root: Root) {
        assignment: MyApp.Assignment [
            assignment->user:Jinaga.User = user
            assignment->project:MyApp.Project->root: Root = root
            !E {
                revoked: MyApp.Assignment.Revoked [
                    revoked->assignment:MyApp.Assignment = assignment
                ]
            }
        ]
    }`);

// Every join walks predecessors, so no feed survives the filter. The
// existential condition on such a match does not change that.
export const predecessorWalkWithExistentialCondition = parse(`
    (child: Child) {
        root: Root [
            root = child->root: Root
            !E {
                project: MyApp.Project [
                    project = root->project: MyApp.Project
                ]
            }
        ]
    }`);

// jinaga/jinaga-replicator#52: a negative existential that follows a positive
// one must stay attached to its own match, not to the flattened positive match.
export const siblingNegativeAfterPositive = parse(`
    (root: Root) {
        item: Item [
            item->root: Root = root
            E {
                tag: Tag [
                    tag->item: Item = item
                ]
            }
            !E {
                del: Deleted [
                    del->item: Item = item
                ]
            }
        ]
    }`);

// A mis-attached existential produced a feed that threw "Label u2 not found"
// during inversion.
export const mixedPositiveAndNegativeExistentials = parse(`
    (user: Jinaga.User) {
        provisioner: Provisioner [
            provisioner->user: Jinaga.User = user
        ]
        request: Request [
            request->domain: Domain = provisioner->domain: Domain
            E {
                redemption: Redemption [
                    redemption->request: Request = request
                ]
            }
            !E {
                workspace: Workspace [
                    workspace->request: Request = request
                ]
                owner: Owner [
                    owner->workspace: Workspace = workspace
                ]
            }
            !E {
                denied: Denied [
                    denied->request: Request = request
                ]
            }
        ]
    } => request`);

export const deeplyNestedProjection = parse(`
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
    }`);

export const projectionOfSuccessor = parse(`
    (root: Root) {
        project: MyApplication.Project [
            project->root: Root = root
        ]
    } => {
        names = {
            name: MyApplication.Project.Name [
                name->project: MyApplication.Project = project
            ]
        }
    }`);

export const deleteAndRestoreWithProjection = parse(`
    (tenant: Tenant) {
        event: Event [
            event->tenant: Tenant = tenant
            !E {
                d: EventDelete [
                    d->event: Event = event
                    !E {
                        r: EventRestore [
                            r->eventDelete: EventDelete = d
                        ]
                    }
                ]
            }
        ]
    } => {
        names = {
            name: EventName [
                name->event: Event = event
            ]
        }
    }`);

export const deleteAndRestoreWithTwoProjectionComponents = parse(`
    (tenant: Tenant) {
        event: Event [
            event->tenant: Tenant = tenant
            !E {
                d: EventDelete [
                    d->event: Event = event
                    !E {
                        r: EventRestore [
                            r->eventDelete: EventDelete = d
                        ]
                    }
                ]
            }
        ]
    } => {
        dates = {
            date: EventDate [
                date->event: Event = event
            ]
        }
        names = {
            name: EventName [
                name->event: Event = event
            ]
        }
    }`);

export const neverDeletedWithProjection = parse(`
    (root: Root) {
        project: MyApplication.Project [
            project->root: Root = root
            !E {
                deleted: MyApplication.Project.Deleted [
                    deleted->project: MyApplication.Project = project
                ]
            }
        ]
    } => {
        names = {
            name: MyApplication.Project.Name [
                name->project: MyApplication.Project = project
            ]
        }
    }`);

// Parity 1 (delete) hides, parity 2 (restore) restores, parity 3 (unrestore)
// hides again, so only the parity-2 branch carries the projection.
export const threeLevelRestoreWithProjection = parse(`
    (tenant: Tenant) {
        event: Event [
            event->tenant: Tenant = tenant
            !E {
                del: EventDelete [
                    del->event: Event = event
                    !E {
                        rest: EventRestore [
                            rest->eventDelete: EventDelete = del
                            !E {
                                unrest: EventUnRestore [
                                    unrest->eventRestore: EventRestore = rest
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    } => {
        names = {
            name: EventName [
                name->event: Event = event
            ]
        }
    }`);

// `approver` is consumed inside the restore branch and again in the projection,
// so the restoring feed must not declare it twice.
export const givenConsumedInRestoreBranch = parse(`
    (tenant: Tenant, approver: Approver) {
        event: Event [
            event->tenant: Tenant = tenant
            !E {
                del: EventDelete [
                    del->event: Event = event
                    !E {
                        rest: EventRestore [
                            rest->eventDelete: EventDelete = del
                            rest->approver: Approver = approver
                        ]
                    }
                ]
            }
        ]
    } => {
        names = {
            name: EventName [
                name->event: Event = event
                name->approver: Approver = approver
            ]
        }
    }`);

// ---------------------------------------------------------------------------
// restoringFeedSiblingConditionsSpec.ts (#427)
// ---------------------------------------------------------------------------

// An event is hidden by a delete unless the delete has a restore or an undo.
export const cancelledTwice = parse(`
    (t: Tenant) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    !E {
                        x: Restore [
                            x->delete: Delete = d
                        ]
                    }
                    !E {
                        u: Undo [
                            u->delete: Delete = d
                        ]
                    }
                ]
            }
        ]
        n: Name [
            n->event: Event = e
        ]
    } => {
        event = e
        name = n
    }
`);

// The same, but a restore can itself be revoked.
export const cancelledBySecond = parse(`
    (t: Tenant) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    !E {
                        x: Restore [
                            x->delete: Delete = d
                            !E {
                                v: Revoke [
                                    v->restore: Restore = x
                                ]
                            }
                        ]
                    }
                    !E {
                        u: Undo [
                            u->delete: Delete = d
                        ]
                    }
                ]
            }
        ]
        n: Name [
            n->event: Event = e
        ]
    } => {
        event = e
        name = n
    }
`);

// A positive condition on the delete, flattened before its negative ones. The
// restoring feeds start from the delete's level with that positive condition
// joined, and nothing else.
export const cancelledAfterPositive = parse(`
    (t: Tenant) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    E {
                        a: Approval [
                            a->delete: Delete = d
                        ]
                    }
                    !E {
                        x: Restore [
                            x->delete: Delete = d
                        ]
                    }
                    !E {
                        u: Undo [
                            u->delete: Delete = d
                        ]
                    }
                ]
            }
        ]
        n: Name [
            n->event: Event = e
        ]
    } => {
        event = e
        name = n
    }
`);

// The restore names a given that nothing before it uses. Attaching the
// restore's condition to the delete consumes that given, but the undo's
// restoring feed starts from before that condition, so it still has the given
// to bind when the name reaches it.
export const cancelledWithGiven = parse(`
    (t: Tenant, g: Group) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    !E {
                        x: Restore [
                            x->delete: Delete = d
                            x->group: Group = g
                        ]
                    }
                    !E {
                        u: Undo [
                            u->delete: Delete = d
                        ]
                    }
                ]
            }
        ]
        n: Name [
            n->event: Event = e
            n->group: Group = g
        ]
    } => {
        event = e
        name = n
    }
`);

// A delete counts only while it is flagged by a flag that has not been
// cleared, unless it is undone. The flag's negative condition sits on a match a
// positive condition joins to the delete, so it is as much a way to cancel the
// delete as the undo is. Each restoring feed has to drop the other.
export const flaggedDelete = parse(`
    (t: Tenant) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    E {
                        y: Flag [
                            y->delete: Delete = d
                            !E {
                                z: Clear [
                                    z->flag: Flag = y
                                ]
                            }
                        ]
                    }
                    !E {
                        u: Undo [
                            u->delete: Delete = d
                        ]
                    }
                ]
            }
        ]
        n: Name [
            n->event: Event = e
        ]
    } => {
        event = e
        name = n
    }
`);

// ---------------------------------------------------------------------------
// repeatedLabelFeedSpec.ts (#426)
// ---------------------------------------------------------------------------

// A label declared inside a negative condition and declared again by a child
// specification. `rate` is the child's label, spelled two ways: the respelling
// means the same, so a rule over one has to authorize the other.
const rehiredServerRates = (next: string, rate = "sr") => parse(`
    (r: Restaurant) {
        s: Server [
            s->restaurant: Restaurant = r
            !E {
                st: Terminated [
                    st->server: Server = s
                    !E {
                        sr: Rehired [
                            sr->terminated: Terminated = st
                        ]
                    }
                ]
            }
        ]
    } => {
        rates = {
            ${rate}: Rate [
                ${rate}->server: Server = s
                ${next.replace(/\bsr\b/g, rate)}
            ]
        } => ${rate}
    }`);

const withNext = `!E { next: Rate [ next->prior: Rate = sr ] }`;

export const repeatedLabelWithNext = rehiredServerRates(withNext);
export const repeatedLabelWithNextRespelled = rehiredServerRates(withNext, "rate");
export const repeatedLabelWithoutNext = rehiredServerRates(``);
export const repeatedLabelWithoutNextRespelled = rehiredServerRates(``, "rate");

// ---------------------------------------------------------------------------
// existsInsideNotExistsFeedSpec.ts (#425)
// ---------------------------------------------------------------------------

// An event with no approved delete.
export const eventsWithoutApprovedDelete = parse(`
    (t: Tenant) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    E {
                        a: Approval [
                            a->delete: Delete = d
                        ]
                    }
                ]
            }
        ]
    } => e`);

// One level deeper: the approval itself carries a condition on a revocation. A
// positive one joins the negative condition's level; a negative one stays out
// of the filter and branches a restoring feed instead.
const withRevocationCondition = (quantifier: "E" | "!E") => parse(`
    (t: Tenant) {
        e: Event [
            e->tenant: Tenant = t
            !E {
                d: Delete [
                    d->event: Event = e
                    E {
                        a: Approval [
                            a->delete: Delete = d
                            ${quantifier} {
                                r: Revocation [
                                    r->approval: Approval = a
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    } => e`);

export const eventsWithoutRevokedApprovedDelete = withRevocationCondition("E");
export const eventsWithoutUnrevokedApprovedDelete = withRevocationCondition("!E");

// jinaga-spec's feed vector `feeds/random-2`: the excluded fact `e1715` carries
// its own negative condition, and that one holds a positive condition. The
// conditions on `e1716` and `e1715`'s own `!E` join only the given, never the
// unknown they sit on, which the parser refused until #434.
export const randomTwo = parse(`
    (p1: R, p2: A) {
        u1: B [
            u1->r: R = p1
            !E {
                e1715: A [
                    e1715->b: B = u1
                    E {
                        e1716: A [
                            e1716->b: B = u1
                            !E {
                                e1717: A [
                                    e1717->r: R = p1
                                ]
                            }
                        ]
                    }
                    !E {
                        e1718: A [
                            e1718->b: B = u1
                            E {
                                e1719: A [
                                    e1719->r: R = p1
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    } => u1`);

// ---------------------------------------------------------------------------
// The case list
// ---------------------------------------------------------------------------

export interface FeedCase {
    /** Unique, and the base name of the vector file the generator writes. */
    name: string;
    specification: Specification;
}

export const feedCases: FeedCase[] = [
    // feedBuilderSpec.ts
    { name: "identity", specification: identity },
    { name: "simple-successor", specification: simpleSuccessor },
    { name: "projection-of-identity", specification: projectionOfIdentity },
    { name: "projection-with-two-properties", specification: projectionWithTwoProperties },
    { name: "two-givens", specification: twoGivens },
    { name: "negative-existential-condition", specification: negativeExistentialCondition },
    { name: "predecessor-walk-with-existential-condition", specification: predecessorWalkWithExistentialCondition },
    { name: "sibling-negative-after-positive", specification: siblingNegativeAfterPositive },
    { name: "mixed-positive-and-negative-existentials", specification: mixedPositiveAndNegativeExistentials },
    { name: "deeply-nested-projection", specification: deeplyNestedProjection },
    { name: "projection-of-successor", specification: projectionOfSuccessor },
    { name: "delete-and-restore-with-projection", specification: deleteAndRestoreWithProjection },
    { name: "delete-and-restore-with-two-projection-components", specification: deleteAndRestoreWithTwoProjectionComponents },
    { name: "never-deleted-with-projection", specification: neverDeletedWithProjection },
    { name: "three-level-restore-with-projection", specification: threeLevelRestoreWithProjection },
    { name: "given-consumed-in-restore-branch", specification: givenConsumedInRestoreBranch },

    // siblingConditionFeedSpec.ts
    { name: "needs-mirror", specification: sibling.needsMirror.specification },
    { name: "needs-mirror-swapped", specification: sibling.needsMirrorSwapped.specification },

    // nestedNotExistsFeedSpec.ts
    { name: "access-paths-to-configure", specification: nested.accessPathsToConfigure.specification },
    { name: "access-paths-with-configuration", specification: nested.accessPathsWithConfiguration.specification },

    // correlatedNotExistsRetractionSpec.ts
    { name: "to-sync", specification: correlated.toSync.specification },

    // predecessorNotExistsDistributionSpec.ts
    { name: "minimal-via-predecessor-not-exists", specification: minimalPredecessor.viaPredecessorNotExists.specification },
    { name: "minimal-via-successors", specification: minimalPredecessor.viaSuccessors.specification },
    { name: "production-via-predecessor-not-exists", specification: productionPredecessor.viaPredecessorNotExists.specification },
    { name: "production-via-compact-predecessor-not-exists", specification: productionPredecessor.viaCompactPredecessorNotExists.specification },
    { name: "production-via-successors", specification: productionPredecessor.viaSuccessors.specification },

    // intermediateProjectionFeedSpec.ts
    { name: "competitor-names-of-finalists", specification: intermediate.competitorNamesOfFinalists.specification },
    { name: "finalists-of-event", specification: intermediate.finalistsOfEvent.specification },

    // positiveExistentialBranchFeedSpec.ts
    { name: "served-and-unfrozen", specification: positive.servedAndUnfrozen.specification },
    { name: "served-and-unfrozen-swapped", specification: positive.servedAndUnfrozenSwapped.specification },
    { name: "served-and-unfrozen-with-regions", specification: positive.servedAndUnfrozenWithRegions.specification },

    // restoringFeedSiblingConditionsSpec.ts
    { name: "cancelled-twice", specification: cancelledTwice },
    { name: "cancelled-by-second", specification: cancelledBySecond },
    { name: "cancelled-after-positive", specification: cancelledAfterPositive },
    { name: "cancelled-with-given", specification: cancelledWithGiven },
    { name: "flagged-delete", specification: flaggedDelete },

    // repeatedLabelFeedSpec.ts
    { name: "repeated-label-with-next", specification: repeatedLabelWithNext },
    { name: "repeated-label-with-next-respelled", specification: repeatedLabelWithNextRespelled },
    { name: "repeated-label-without-next", specification: repeatedLabelWithoutNext },
    { name: "repeated-label-without-next-respelled", specification: repeatedLabelWithoutNextRespelled },

    // existsInsideNotExistsFeedSpec.ts
    { name: "events-without-approved-delete", specification: eventsWithoutApprovedDelete },
    { name: "events-without-revoked-approved-delete", specification: eventsWithoutRevokedApprovedDelete },
    { name: "events-without-unrevoked-approved-delete", specification: eventsWithoutUnrevokedApprovedDelete },
    { name: "random-two", specification: randomTwo }
];
