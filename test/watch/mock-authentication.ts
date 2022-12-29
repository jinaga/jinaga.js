import { Authentication } from "../../src/authentication/authentication";
import { Channel } from "../../src/fork/channel";
import { LoginResponse } from "../../src/http/messages";
import { Observable, ObservableSource, SpecificationListener } from "../../src/observable/observable";
import { ObservableSourceImpl } from "../../src/observable/observable-source-impl";
import { Query } from "../../src/query/query";
import { Feed } from "../../src/specification/feed";
import { Specification } from "../../src/specification/specification";
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, Storage } from "../../src/storage";

export class MockAuthentication implements Authentication {
  private inner: ObservableSource;

  constructor(
      storage: Storage
  ) {
      this.inner = new ObservableSourceImpl(storage);
  }

  async close(): Promise<void> {
      return this.inner.close();
  }
  login(): Promise<LoginResponse> {
      throw new Error("Method not implemented: login.");
  }
  local(): Promise<FactRecord> {
      throw new Error("Method not implemented: local.");
  }
  from(fact: FactReference, query: Query): Observable {
      return this.inner.from(fact, query);
  }
  addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>) {
    return this.inner.addSpecificationListener(specification, onResult);
  }
  removeSpecificationListener(listener: SpecificationListener) {
    return this.inner.removeSpecificationListener(listener);
  }
  save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
    return this.inner.save(envelopes);
  }
  query(start: FactReference, query: Query): Promise<FactReference[][]> {
      return this.inner.query(start, query);
  }
  read(start: FactReference[], specification: Specification): Promise<any[]> {
      return this.inner.read(start, specification);
  }
  feed(feed: Feed, bookmark: string): Promise<FactFeed> {
      return this.inner.feed(feed, bookmark);
  }
  whichExist(references: FactReference[]): Promise<FactReference[]> {
    throw new Error("WhichExist method not implemented on MockAuthentication.");
  }
  load(references: FactReference[]): Promise<FactRecord[]> {
      return this.inner.load(references);
  }
  addChannel(fact: FactReference, query: Query): Channel {
    throw new Error("AddChannel method not implemented on MockAuthentication.");
  }
  removeChannel(channel: Channel): void {
    throw new Error("RemoveChannel method not implemented on MockAuthentication.");
  }
}
