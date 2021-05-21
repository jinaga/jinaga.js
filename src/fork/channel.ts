
export class Channel {
    constructor(
        private initiateQuery: () => Promise<void>) { }

    async process() {
        await this.initiateQuery();
    }
}