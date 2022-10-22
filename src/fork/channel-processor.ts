import { Trace } from "../util/trace";
import { Channel } from "./channel";

export class ChannelProcessor {
    private running = true;
    private timer: NodeJS.Timer | undefined;

    constructor(
        private channels: Channel[]
    ) { }

    start() {
        this.timer = setTimeout(() => this.run(), 5000);
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
    }

    private async run() {
        try {
            for (const channel of this.channels) {
                await channel.process();
            }
        }
        catch (err) {
            Trace.error(err);
        }
        finally {
            if (this.running) {
                this.timer = setTimeout(() => this.run(), 5000);
            }
        }
    }
}