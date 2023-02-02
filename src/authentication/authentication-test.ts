import { Authentication } from '../authentication/authentication';
import { AuthorizationEngine } from '../authorization/authorization-engine';
import { AuthorizationRules } from '../authorization/authorizationRules';
import { LoginResponse } from '../http/messages';
import { ObservableSource } from '../observable/observable';
import { FactEnvelope, FactRecord } from '../storage';

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
  
  async authorize(envelopes: FactEnvelope[]) {
    if (this.authorizationEngine) {
      await this.authorizationEngine.authorizeFacts(envelopes.map(e => e.fact), this.userFact);
    }
  }
}
