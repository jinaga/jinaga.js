import { Authentication } from '../../src/authentication/authentication';
import { Channel } from '../../src/fork/channel';
import { LoginResponse } from '../../src/http/messages';
import { Observable, SpecificationListener } from '../../src/observable/observable';
import { Query } from '../../src/query/query';
import { Feed } from '../../src/specification/feed';
import { Specification } from '../../src/specification/specification';
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult } from '../../src/storage';

export class AuthenticationNoOp implements Authentication {
    login(): Promise<LoginResponse> {
        throw new Error('Method not implemented.');
    }
    local(): Promise<FactRecord> {
        throw new Error('Method not implemented.');
    }
    addChannel(fact: FactReference, query: Query): Channel {
        throw new Error('Method not implemented.');
    }
    removeChannel(channel: Channel): void {
        throw new Error('Method not implemented.');
    }
    from(fact: FactReference, query: Query): Observable {
        throw new Error('Method not implemented.');
    }
    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        throw new Error('Method not implemented.');
    }
    removeSpecificationListener(listener: SpecificationListener): void {
        throw new Error('Method not implemented.');
    }
    close(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        throw new Error('Method not implemented.');
    }
    query(start: FactReference, query: Query): Promise<FactPath[]> {
        throw new Error('Method not implemented.');
    }
    read(start: FactReference[], specification: Specification): Promise<any[]> {
        throw new Error('Method not implemented.');
    }
    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        throw new Error('Method not implemented.');
    }
    whichExist(references: FactReference[]): Promise<FactReference[]> {
        throw new Error('Method not implemented.');
    }
    load(references: FactReference[]): Promise<FactRecord[]> {
        throw new Error('Method not implemented.');
    }
    public getAccessToken(): Promise<string> {
        throw new Error('Method not implemented.');
    }
}
