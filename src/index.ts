export { Authentication } from './authentication/authentication';
export { AuthenticationNoOp } from './authentication/authentication-noop';
export { AuthenticationTest } from './authentication/authentication-test';
export { Authorization } from './authorization/authorization';
export { AuthorizationEngine, Forbidden } from './authorization/authorization-engine';
export { AuthorizationNoOp } from "./authorization/authorization-noop";
export { AuthorizationRules, describeAuthorizationRules } from "./authorization/authorizationRules";
export { generateKeyPair, KeyPair, signFacts } from "./cryptography/key-pair";
export { verifyEnvelopes } from "./cryptography/verify";
export { DistributionEngine } from './distribution/distribution-engine';
export { describeDistributionRules, DistributionRules } from './distribution/distribution-rules';
export { canonicalizeFact, canonicalPredecessors, computeHash, computeObjectHash, verifyHash } from './fact/hash';
export { dehydrateFact, dehydrateReference, Dehydration, HashMap, hydrate, hydrateFromTree, Hydration } from "./fact/hydrate";
export { TopologicalSorter } from './fact/sorter';
export { Fork } from "./fork/fork";
export { PassThroughFork } from "./fork/pass-through-fork";
export { PersistentFork } from "./fork/persistent-fork";
export { TransientFork } from './fork/transient-fork';
export { AuthenticationProvider, HttpHeaders } from "./http/authenticationProvider";
export { GraphDeserializer, GraphSource } from "./http/deserializer";
export { FetchConnection } from "./http/fetch";
export { HttpNetwork } from "./http/httpNetwork";
export { parseLoadMessage, parseSaveMessage } from './http/messageParsers';
export {
  FeedResponse,
  FeedsResponse,
  LoadMessage,
  LoadResponse,
  LoginResponse,
  ProfileMessage,
  SaveMessage
} from './http/messages';
export { GraphSerializer, serializeGraph } from "./http/serializer";
export { HttpConnection, HttpResponse, SyncStatus, SyncStatusNotifier, WebClient } from "./http/web-client";
export * as driver from './indexeddb/driver';
export { IndexedDBQueue } from './indexeddb/indexeddb-queue';
export { Fact, Jinaga, MakeObservable, Profile } from './jinaga';
export { JinagaBrowser, JinagaBrowserConfig } from "./jinaga-browser";
export { JinagaTest, JinagaTestConfig } from "./jinaga-test";
export { FactManager } from "./managers/factManager";
export { Network, NetworkManager, NetworkNoOp } from "./managers/NetworkManager";
export { QueueProcessor, Saver } from './managers/QueueProcessor';
export { MemoryStore } from './memory/memory-store';
export { Device, User, UserName } from "./model/user";
export { ObservableSource, ObservableSource as ObservableSourceImpl, SpecificationListener } from './observable/observable';
export { ObservableCollection } from './observer/observer';
export { Subscriber } from './observer/subscriber';
export { PurgeConditions } from './purge/purgeConditions';
export { validatePurgeSpecification } from './purge/validate';
export { RuleSet } from './rules/RuleSet';
export { Declaration } from './specification/declaration';
export { describeDeclaration, describeSpecification } from './specification/description';
export { buildFeeds } from './specification/feed-builder';
export { FeedCache, FeedObject } from "./specification/feed-cache";
export { invertSpecification, SpecificationInverse } from "./specification/inverse";
export { buildModel, FactRepository, LabelOf, Model, ModelBuilder, ProjectionOf, SpecificationOf } from './specification/model';
export { EdgeDescription, emptySkeleton, FactDescription, InputDescription, NotExistsConditionDescription, OutputDescription, Skeleton, skeletonOfSpecification } from './specification/skeleton';
export { ComponentProjection, CompositeProjection, detectDisconnectedSpecification, DisconnectedSpecificationError, FactProjection, FieldProjection, getAllFactTypes, getAllRoles, HashProjection, Label, Match, PathCondition, Projection, SingularProjection, Specification, specificationIsDeterministic, specificationIsNotDeterministic, SpecificationProjection, splitBeforeFirstSuccessor } from './specification/specification';
export { Invalid, SpecificationParser } from './specification/specification-parser';
export { computeTupleSubsetHash, FactEnvelope, factEnvelopeEquals, FactFeed, FactRecord, FactReference, factReferenceEquals, FactSignature, FactTuple, PredecessorCollection, ProjectedResult, Queue, ReferencesByName, Storage, uniqueFactReferences, validateGiven } from './storage';
export { UserIdentity } from './user-identity';
export { delay } from './util/promise';
export { ConsoleTracer, NoOpTracer, Trace, Tracer } from './util/trace';

// Optional WebSocket graph client and network
export { WsGraphNetwork } from './ws/wsGraphNetwork';

// Server-side WebSocket authorization helpers
export { AuthorizationWebSocketHandler } from './ws/authorization-websocket-handler';
export { BookmarkManager } from './ws/bookmark-manager';
export { InverseSpecificationEngine } from './ws/inverse-specification-engine';

// Export the JinagaBrowser class using the alias JinagaClient
export { JinagaBrowser as JinagaClient } from "./jinaga-browser";

