import { Authentication } from '../../src/authentication/authentication';
import { LoginResponse } from '../../src/http/messages';
import { FactEnvelope, FactRecord } from '../../src/storage';

 export class AuthenticationNoOp implements Authentication {
    login(): Promise<LoginResponse> {
        throw new Error('Method not implemented.');
    }
    local(): Promise<FactRecord> {
        throw new Error('Method not implemented.');
    }
    authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return Promise.resolve(envelopes);
    }
}
