import { Feed } from "../feed/feed";
import { Query } from "../query/query";
import { FactReference } from "../storage";
import { Channel } from "./channel";

export interface Fork extends Feed {
    addChannel(fact: FactReference, query: Query): Channel;
    removeChannel(channel: Channel): void;
}