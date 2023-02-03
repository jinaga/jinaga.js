import { Authentication } from "../../src/authentication/authentication";
import { LoginResponse } from "../../src/http/messages";
import { ObservableSource } from "../../src/observable/observable";
import { FactEnvelope, FactRecord, Storage } from "../../src/storage";

export class MockAuthentication implements Authentication {
  private inner: ObservableSource;

  constructor(
      storage: Storage
  ) {
      this.inner = new ObservableSource(storage);
  }

  login(): Promise<LoginResponse> {
      throw new Error("Method not implemented: login.");
  }
  local(): Promise<FactRecord> {
      throw new Error("Method not implemented: local.");
  }
  authorize(envelopes: FactEnvelope[]): Promise<void> {
    return Promise.resolve();
  }
}
