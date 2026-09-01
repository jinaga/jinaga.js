export { Authentication } from './authentication/authentication';
export { AuthenticationNoOp } from './authentication/authentication-noop';
export { AuthenticationTest } from './authentication/authentication-test';
export { Authorization } from './authorization/authorization';
export { AuthorizationEngine, Forbidden } from './authorization/authorization-engine';
export { AuthorizationNoOp } from "./authorization/authorization-noop";
export { AuthorizationRules, describeAuthorizationRules } from "./authorization/authorizationRules";
export { AuthorizationRuleError, PredecessorNotResolvedError } from "./authorization/errors";
export { generateKeyPair, KeyPair, signFacts } from "./cryptography/key-pair";
export { verifyEnvelopes } from "./cryptography/verify";
export { DistributionEngine, DistributionDenialCode, distributionDenialCodes, DistributionFailure, DistributionPerFeedFailure, DistributionResult, DistributionSuccess } from './distribution/distribution-engine';
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
export { ForbiddenError, HttpError } from "./http/errors";
export { FetchConnection } from "./http/fetch";
export { DEFAULT_MAX_SAVE_BATCH_BYTES, DEFAULT_MAX_SAVE_BATCH_COUNT, WebClientSaverOptions } from "./fork/web-client-saver";
export { HttpNetwork } from "./http/httpNetwork";
export { parseFeedsResponse, parseLoadMessage, parseSaveMessage } from './http/messageParsers';
export {
  FeedDecision,
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
export { DistributionDeniedError, DistributionDiagnostic, Fact, Jinaga, MakeObservable, Profile } from './jinaga';
export { JinagaBrowser, JinagaBrowserConfig } from "./jinaga-browser";
export { JinagaTest, JinagaTestConfig } from "./jinaga-test";
export { FactManager } from "./managers/factManager";
export { Network, NetworkManager, NetworkNoOp } from "./managers/NetworkManager";
export { QueueProcessor, Saver } from './managers/QueueProcessor';
export { MemoryStore } from './memory/memory-store';
export { Device, User, UserName } from "./model/user";
export { DEFAULT_LISTENER_TIMEOUT_MS, ObservableSource, ObservableSource as ObservableSourceImpl, SpecificationListener } from './observable/observable';
export { DEFAULT_ROW_STREAM_CAPACITY, RowStream, RowStreamOptions, SpecificationChange } from './observer/row-stream';
export { ObservableCollection } from './observer/observer';
export { Subscriber } from './observer/subscriber';
export { PurgeConditions } from './purge/purgeConditions';
export { validatePurgeSpecification } from './purge/validate';
export { RuleSet } from './rules/RuleSet';
export { Declaration } from './specification/declaration';
export { describeDeclaration, describeSpecification } from './specification/description';
export { buildFeeds } from './specification/feed-builder';
export { FeedCache, FeedObject } from "./specification/feed-cache";
export { clearInverseCache, DEFAULT_INVERSE_CACHE_CAPACITY, inverseCacheStatistics, InverseCacheStatistics, invertSpecification, setInverseCacheCapacity, SpecificationInverse } from "./specification/inverse";
export { alphaTransform, DISTRIBUTION_USER_LABEL, intersectSpecificationWithDistributionRule, specificationHasIntersection } from "./specification/specification-intersection";
export { buildModel, FactRepository, LabelOf, Model, ModelBuilder, ProjectionOf, SpecificationOf } from './specification/model';
export { SpecificationRow } from './specification/row';
export { EdgeDescription, emptySkeleton, FactDescription, InputDescription, NotExistsConditionDescription, OutputDescription, Skeleton, skeletonOfSpecification } from './specification/skeleton';
export { ComponentProjection, CompositeProjection, Condition, emptySpecification, ExistentialCondition, FactProjection, FieldProjection, getAllFactTypes, getAllRoles, HashProjection, isExistentialCondition, isPathCondition, Label, Match, NamedComponentProjection, PathCondition, Projection, reduceSpecification, Role, SingularProjection, Specification, SpecificationGiven, specificationIsDeterministic, specificationIsIdentity, specificationIsNotDeterministic, SpecificationProjection, splitBeforeFirstSuccessor, TimeProjection } from './specification/specification';
export { Invalid, SpecificationParser } from './specification/specification-parser';
export { validateSpecification, validateSpecificationOrThrow } from './specification/specification-validation';
export { detectDisconnectedSpecification, DisconnectedSpecificationError } from "./specification/UnionFind";
export { computeTupleSubsetHash, FactEnvelope, factEnvelopeEquals, FactFeed, FactRecord, FactReference, factReferenceEquals, FactSignature, FactTuple, PredecessorCollection, ProjectedResult, Queue, ReferencesByName, Storage, uniqueFactReferences, validateGiven } from './storage';
export { UserIdentity } from './user-identity';
export { ValidationError } from './util/errors';
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

