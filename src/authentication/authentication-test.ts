import { Authentication } from '../authentication/authentication';
import { AuthorizationEngine } from '../authorization/authorization-engine';
import { AuthorizationRules } from '../authorization/authorizationRules';
import { LoginResponse } from '../http/messages';
import { FactEnvelope, FactRecord, Storage } from '../storage';

export class AuthenticationTest implements Authentication {
  private authorizationEngine: AuthorizationEngine | null;

  constructor (
    store: Storage,
    authorizationRules: AuthorizationRules | null,
    private userFact: FactRecord | null,
    private deviceFact: FactRecord | null
  ) {
    this.authorizationEngine = authorizationRules &&
      new AuthorizationEngine(authorizationRules, store);
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
  
  async authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
    if (this.authorizationEngine) {
      const facts = envelopes.map(e => e.fact);
      const authorizedFacts = await this.authorizationEngine.authorizeFacts(facts, this.userFact);
      const authorizedEnvelopes: FactEnvelope[] = authorizedFacts.map(f => ({
        fact: f,
        signatures: []
      }));
      return authorizedEnvelopes;
    }
    else {
      return envelopes;
    }
  }
}
