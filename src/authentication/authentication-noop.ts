import { LoginResponse } from "../http/messages";
import { FactEnvelope, FactRecord } from "../storage";
import { Authentication } from "./authentication";

export class AuthenticationNoOp implements Authentication {
    login(): Promise<LoginResponse> {
        throw new Error('No logged in user.');
    }
    local(): Promise<FactRecord> {
        throw new Error('No persistent device.');
    }
    authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return Promise.resolve(envelopes);
    }
}