import { Authentication } from '../authentication/authentication';
import { AuthorizationEngine } from '../authorization/authorization-engine';
import { AuthorizationRules } from '../authorization/authorizationRules';
import { LoginResponse } from '../http/messages';
import { FactEnvelope, FactRecord, Storage, factEnvelopeEquals } from '../storage';

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
      const results = await this.authorizationEngine.authorizeFacts(envelopes, this.userFact);
      const authorizedEnvelopes: FactEnvelope[] = results.map(r => {
        const envelope = envelopes.find(factEnvelopeEquals(r.fact));
        if (!envelope) {
          throw new Error("Fact not found in envelopes.");
        }
        if (r.verdict === "Accept") {
          return {
            fact: r.fact,
            signatures: envelope.signatures
              .filter(s => r.newPublicKeys.includes(s.publicKey))
          };
        }
        else if (r.verdict === "Existing") {
          return envelope;
        }
        else {
          throw new Error("Unexpected verdict.");
        }
      });
      return authorizedEnvelopes;
    }
    else {
      return envelopes;
    }
  }
}
