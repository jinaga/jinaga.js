import { Authentication } from '../authentication/authentication';
import { AuthorizationEngine } from '../authorization/authorization-engine';
import { ObservableSource, SpecificationListener } from '../observable/observable';
import { LoginResponse } from '../http/messages';
import { Query } from '../query/query';
import { FactEnvelope, FactFeed, FactRecord, FactReference } from '../storage';
import { AuthorizationRules } from '../authorization/authorizationRules';
import { Channel } from "../fork/channel";
import { Specification } from "../specification/specification";
import { Feed } from "../specification/feed";

export class AuthenticationTest implements Authentication {
  private authorizationEngine: AuthorizationEngine | null;

  constructor (
    private inner: ObservableSource,
    authorizationRules: AuthorizationRules | null,
    private userFact: FactRecord | null,
    private deviceFact: FactRecord | null
  ) {
    this.authorizationEngine = authorizationRules &&
      new AuthorizationEngine(authorizationRules, inner);
  }

  async close() {
    await this.inner.close();
  }
  
  async login() {
    if (!this.userFact) {
      throw new Error("No logged in user.");
    }

    return <LoginResponse>{
      userFact: this.userFact,
      profile: {
        displayName: "Test user"
      }
    };
  }
  
  async local() {
    if (!this.deviceFact) {
      throw new Error("No persistent device.");
    }

    return this.deviceFact;
  }

  from(fact: FactReference, query: Query) {
    return this.inner.from(fact, query);
  }

  addSpecificationListener(specification: Specification, onResult: (results: FactReference[]) => Promise<void>) {
    return this.inner.addSpecificationListener(specification, onResult);
  }

  removeSpecificationListener(listener: SpecificationListener) {
      return this.inner.removeSpecificationListener(listener);
  }

  async save(envelopes: FactEnvelope[]) {
    await this.authorize(envelopes);
    return await this.inner.save(envelopes);
  }

  query(start: FactReference, query: Query) {
    return this.inner.query(start, query);
  }

  read(start: FactReference[], specification: Specification): Promise<any[]> {
    return this.inner.read(start, specification);
  }

  feed(feed: Feed, bookmark: string): Promise<FactFeed> {
    return this.inner.feed(feed, bookmark);
  }

  whichExist(references: FactReference[]): Promise<FactReference[]> {
    return this.inner.whichExist(references);
  }

  load(references: FactReference[]) {
    return this.inner.load(references);
  }

  addChannel(fact: FactReference, query: Query): Channel {
    return Channel.NoOp;
  }

  removeChannel(channel: Channel): void {
  }
  
  private async authorize(envelopes: FactEnvelope[]) {
    if (this.authorizationEngine) {
      await this.authorizationEngine.authorizeFacts(envelopes.map(e => e.fact), this.userFact);
    }
  }
}
