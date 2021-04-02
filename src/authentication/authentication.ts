import { Fork } from "../fork/fork";
import { LoginResponse } from '../http/messages';
import { FactRecord } from '../storage';

export interface Authentication extends Fork {
    login(): Promise<LoginResponse>;
    local(): Promise<FactRecord>;
}