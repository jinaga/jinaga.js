import { FactReference } from '../storage';
import { ValidationError } from '../util/errors';

/**
 * Thrown when an authorization rule is defined incorrectly — an unsatisfiable
 * specification, a projection that isn't a fact, a label that isn't in scope.
 * These are authoring mistakes, not runtime denials: `Forbidden` covers the
 * latter.
 */
export class AuthorizationRuleError extends ValidationError {
    constructor(message: string) {
        super(message);
        this.name = 'AuthorizationRuleError';
        Object.setPrototypeOf(this, AuthorizationRuleError.prototype);
    }
}

/**
 * Thrown by `AuthorizationEngine.authorizeFacts` when a fact in the batch names
 * a predecessor that is neither in the batch nor in storage, so the fact can
 * never be sorted and authorized. `missingPredecessors` names the references
 * that could not be found; `unresolvedFacts` names the facts that depend on
 * them.
 */
export class PredecessorNotResolvedError extends ValidationError {
    constructor(
        message: string,
        public readonly missingPredecessors: FactReference[],
        public readonly unresolvedFacts: FactReference[]
    ) {
        super(message);
        this.name = 'PredecessorNotResolvedError';
        Object.setPrototypeOf(this, PredecessorNotResolvedError.prototype);
    }
}
