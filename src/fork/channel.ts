import { Query } from "../query/query";
import { FactReference } from "../storage";

export class Channel {
    constructor(
        private start: FactReference,
        private query: Query,
        private initiateQuery: (start: FactReference, query: Query) => Promise<void>) { }

    async process() {
        await this.initiateQuery(this.start, this.query);
    }
}