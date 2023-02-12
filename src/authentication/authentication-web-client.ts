import { Fork } from "../fork/fork";
import { WebClient } from '../http/web-client';
import { FactEnvelope, FactRecord } from '../storage';
import { Authentication } from './authentication';

export class AuthenticationWebClient implements Authentication {
    constructor(private client: WebClient) {
    }

    login() {
        return this.client.login();
    }

    local(): Promise<FactRecord> {
        throw new Error('Local device has no persistence.');
    }

    authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return Promise.resolve(envelopes);
    }
}