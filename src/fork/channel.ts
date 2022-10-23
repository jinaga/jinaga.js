
export class Channel {
    static NoOp = new Channel(() => Promise.resolve());

    constructor(
        private initiateQuery: () => Promise<void>) { }

    async process() {
        await this.initiateQuery();
    }
}