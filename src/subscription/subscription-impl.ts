import { Channel } from "../fork/channel";
import { FactManager } from "../managers/factManager";
import { Subscription } from "./subscription";

export class SubscriptionImpl implements Subscription {
    constructor(
        private channel: Channel,
        private factManager: FactManager
    ) {
        
    }

    stop() {
        this.factManager.removeChannel(this.channel);
    }
}