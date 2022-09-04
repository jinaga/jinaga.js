import { ObservableSource } from "../observable/observable";
import { Query } from "../query/query";
import { FactReference } from "../storage";
import { Channel } from "./channel";

export interface Fork extends ObservableSource {
    addChannel(fact: FactReference, query: Query): Channel;
    removeChannel(channel: Channel): void;
}