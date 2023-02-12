import { LoadMessage, QueryMessage, SaveMessage } from '../http/messages';
import { Query } from '../query/query';
import { FactEnvelope, FactReference } from '../storage';

export function serializeSave(envelopes: FactEnvelope[]) : SaveMessage {
    return {
        facts: envelopes.map(e => e.fact)
    };
}

export function serializeQuery(start: FactReference, query: Query) : QueryMessage {
    return {
        start: start,
        query: query.toDescriptiveString()
    };
}

export function serializeLoad(references: FactReference[]) : LoadMessage {
    return {
        references: references
    };
}
