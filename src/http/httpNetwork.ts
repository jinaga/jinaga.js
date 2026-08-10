import { Specification } from "../specification/specification";
import { FactReference, FactEnvelope } from "../storage";
import { Network } from "../managers/NetworkManager";
import { FeedResponse, FeedsResponse, LoadResponse } from "./messages";
import { WebClient } from "./web-client";
import { describeDeclaration, describeSpecification } from "../specification/description";

export class HttpNetwork implements Network {
    // Backed by a replicator, so `load` can supply facts the local store lacks.
    readonly canLoad = true;

    constructor(
        private readonly webClient: WebClient
    ) { }

    async feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        const declarationString = describeDeclaration(start, specification.given.map(g => g.label));
        const specificationString = describeSpecification(specification, 0);
        const request = `${declarationString}\n${specificationString}`;
        // Return the full response so the NetworkManager can capture the
        // replicator's per-feed distribution decisions (issue #207 W4).
        const response: FeedsResponse = await this.webClient.feeds(request);
        return response;
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        const response: FeedResponse = await this.webClient.feed(feed, bookmark);
        return response;
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void {
        return this.webClient.streamFeed(feed, bookmark, async (response: FeedResponse) => {
            await onResponse(response.references, response.bookmark);
        }, onError, feedRefreshIntervalSeconds);
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