import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { Subscription } from "./subscription";

export class SubscriptionImpl implements Subscription {
    constructor(
        private channel: Channel,
        private inner: Fork
    ) {
        
    }

    stop() {
        this.inner.removeChannel(this.channel);
    }
}