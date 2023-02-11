import { Channel } from '../../src/fork/channel';
import { Fork } from '../../src/fork/fork';
import { Observable } from '../../src/observable/observable';
import { Query } from '../../src/query/query';
import { FactEnvelope, FactPath, FactRecord, FactReference } from '../../src/storage';


export class ForkNoOp implements Fork {
    addChannel(fact: FactReference, query: Query): Channel {
        throw new Error('Method not implemented.');
    }
    removeChannel(channel: Channel): void {
        throw new Error('Method not implemented.');
    }
    close(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    save(envelopes: FactEnvelope[]): Promise<void> {
        throw new Error('Method not implemented.');
    }
    decorateObservable(fact: FactReference, query: Query, observable: Observable): Observable {
        throw new Error('Method not implemented.');
    }
    query(start: FactReference, query: Query): Promise<FactPath[]> {
        throw new Error('Method not implemented.');
    }
    load(references: FactReference[]): Promise<FactRecord[]> {
        throw new Error('Method not implemented.');
    }
}
