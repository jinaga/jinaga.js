import { Subscription } from "./subscription";

export class SubscriptionNoOp implements Subscription {
    stop(): void {
    }

}