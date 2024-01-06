import { LoadMessage, SaveMessage } from '../http/messages';
import { FactEnvelope, FactReference } from '../storage';

export function serializeSave(envelopes: FactEnvelope[]) : SaveMessage {
    return {
        facts: envelopes.map(e => e.fact)
    };
}

export function serializeLoad(references: FactReference[]) : LoadMessage {
    return {
        references: references
    };
}
