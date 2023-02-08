import { LoginResponse } from '../http/messages';
import { FactEnvelope, FactRecord } from '../storage';

export interface Authentication {
    login(): Promise<LoginResponse>;
    local(): Promise<FactRecord>;
    authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]>;
}