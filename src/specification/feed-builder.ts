import { FactReference } from "../storage";
import { Feed } from "./feed";
import { Specification } from "./specification";

export class FeedBuilder {
    buildFeeds(start: FactReference[], specification: Specification): Feed[] {
        throw new Error("Method not implemented.");
    }
}