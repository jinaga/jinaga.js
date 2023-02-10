import { Specification } from "../specification/specification";
import { FactReference, Storage } from "../storage";

export interface Network {

}

export class NetworkNoOp implements Network {

}

export class NetworkManager {
    constructor(
        private readonly network: Network,
        private readonly store: Storage
    ) { }
}
