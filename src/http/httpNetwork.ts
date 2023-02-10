import { Network } from "../managers/NetworkManager";
import { WebClient } from "./web-client";

export class HttpNetwork implements Network {
    constructor(
        private readonly webClient: WebClient
    ) { }

}