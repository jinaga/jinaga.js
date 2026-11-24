/**
 * A specification, or a rule containing one, that is outside the
 * specification language.
 *
 * This is a client error: the text that arrived cannot be given a meaning, so
 * a replica refuses it rather than handing it to its store. It lives in a
 * module of its own so that any module raising such a refusal can extend it
 * without importing the parser.
 */
export class Invalid extends Error {
    __proto__: Error;
    constructor(message?: string) {
        const trueProto = new.target.prototype;
        super(message);

        this.__proto__ = trueProto;
    }
}
