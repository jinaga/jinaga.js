import { Specification } from "../specification/specification";
import { FactReference, FactEnvelope } from "../storage";
import { Network } from "../managers/NetworkManager";
import { FeedResponse, FeedsResponse, LoadResponse } from "./messages";
import { WebClient } from "./web-client";
import { describeDeclaration, describeSpecification } from "../specification/description";

export class HttpNetwork implements Network {
    constructor(
        private readonly webClient: WebClient
    ) { }

    async feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        const declarationString = describeDeclaration(start, specification.given);
        const specificationString = describeSpecification(specification, 0);
        const request = `${declarationString}\n${specificationString}`;
        const response: FeedsResponse = await this.webClient.feeds(request);
        return response.feeds;
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        const response: FeedResponse = await this.webClient.feed(feed, bookmark);
        return response;
    }

    async load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        const response: LoadResponse = await this.webClient.load({
            references: factReferences
        });
        const envelopes = response.facts.map(fact => <FactEnvelope>{
            fact,
            signatures: []
        });
        return envelopes;
    }

}