import { Authentication } from '../../src/authentication/authentication';
import { AuthorizationEngine } from '../../src/authorization/authorization-engine';
import { Feed } from '../../src/feed/feed';
import { LoginResponse } from '../../src/http/messages';
import { Query } from '../../src/query/query';
import { FactEnvelope, FactRecord, FactReference } from '../../src/storage';
import { AuthorizationRules } from '../authorization/authorizationRules';
import { Channel } from "../fork/channel";

export class AuthenticationTest implements Authentication {
  private authorizationEngine: AuthorizationEngine | null;

  constructor (
    private inner: Feed,
    authorizationRules: AuthorizationRules | null,
    private userFact: FactRecord | null,
    private deviceFact: FactRecord | null
  ) {
    this.authorizationEngine = authorizationRules &&
      new AuthorizationEngine(authorizationRules, inner);
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

  async save(envelopes: FactEnvelope[]) {
    await this.authorize(envelopes);
    return await this.inner.save(envelopes);
  }

  query(start: FactReference, query: Query) {
    return this.inner.query(start, query);
  }

  exists(fact: FactReference) {
    return this.inner.exists(fact);
  }

  load(references: FactReference[]) {
    return this.inner.load(references);
  }

  addChannel(fact: FactReference, query: Query): Channel {
    return null;
  }

  removeChannel(channel: Channel): void {
  }
  
  private async authorize(envelopes: FactEnvelope[]) {
    if (this.authorizationEngine) {
      await this.authorizationEngine.authorizeFacts(envelopes.map(e => e.fact), this.userFact);
    }
  }
}
