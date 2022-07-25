import { Handler, Router } from 'express';

import { Authorization } from '../authorization/authorization';
import { Forbidden } from '../authorization/authorization-engine';
import { UserIdentity } from '../keystore';
import { fromDescriptiveString } from '../query/descriptive-string';
import { Declaration } from "../specification/declaration";
import { SpecificationParser } from "../specification/specification-parser";
import { Trace } from '../util/trace';
import {
    LoadMessage,
    LoadResponse,
    ProfileMessage,
    QueryMessage,
    QueryResponse,
    SaveMessage,
    SaveResponse,
} from './messages';

function get<U>(method: ((req: RequestUser) => Promise<U>)): Handler {
    return (req, res, next) => {
        const user = <RequestUser>req.user;
        if (!user) {
            res.sendStatus(401);
        }
        else {
            method(user)
                .then(response => {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(JSON.stringify(response));
                    next();
                })
                .catch(error => {
                    Trace.error(error);
                    res.sendStatus(500);
                    next();
                });
        }
    };
}

function post<T, U>(method: (user: RequestUser, message: T) => Promise<U>): Handler {
    return (req, res, next) => {
        const user = <RequestUser>req.user;
        const message = <T>req.body;
        if (!message) {
            throw new Error('Ensure that you have installed body-parser and called app.use(express.json()).');
        }
        method(user, message)
            .then(response => {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(response));
                next();
            })
            .catch(error => {
                if (error instanceof Forbidden) {
                    Trace.warn(error.message);
                    res.status(403).send(error.message);
                }
                else {
                    Trace.error(error);
                    res.sendStatus(500);
                }
                next();
            });
    };
}

function postString(method: (user: RequestUser, message: string) => Promise<string>): Handler {
    return (req, res, next) => {
        const user = <RequestUser>req.user;
        const input = <string>req.body;
        if (!input || typeof(input) !== 'string') {
            res.setHeader('Content-Type', 'text/plain');
            res.status(500).send('Ensure that you have installed body-parser and called app.use(express.text()).');
        }
        else {
            method(user, input)
                .then(response => {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(response);
                    next();
                })
                .catch(error => {
                    if (error instanceof Forbidden) {
                        Trace.warn(error.message);
                        res.setHeader('Content-Type', 'text/plain');
                        res.status(403).send(error.message);
                    }
                    else {
                        Trace.error(error);
                        res.setHeader('Content-Type', 'text/plain');
                        res.status(400).send(error.message);
                    }
                    next();
                });
        }
    };
}

function serializeUserIdentity(user: RequestUser) : UserIdentity {
    if (!user) {
        return null;
    }
    return {
        provider: user.provider,
        id: user.id
    };
}

export interface RequestUser {
    provider: string;
    id: string;
    profile: ProfileMessage;
}

export class HttpRouter {
    handler: Handler;

    constructor(private authorization: Authorization) {
        const router = Router();
        router.get('/login', get(user => this.login(user)));
        router.post('/query', post((user, queryMessage: QueryMessage) => this.query(user, queryMessage)));
        router.post('/load', post((user, loadMessage: LoadMessage) => this.load(user, loadMessage)));
        router.post('/save', post((user, saveMessage: SaveMessage) => this.save(user, saveMessage)));

        router.post('/read', postString((user, input: string) => this.read(user, input)));
        router.post('/write', post((user, input: string) => this.write(user, input)));
        router.post('/feed', post((user, input: string) => this.feed(user, input)));

        this.handler = router;
    }

    private async login(user: RequestUser) {
        const userFact = await this.authorization.getOrCreateUserFact({
            provider: user.provider,
            id: user.id
        });
        return {
            userFact: userFact,
            profile: user.profile
        };
    }

    private async query(user: RequestUser, queryMessage: QueryMessage) : Promise<QueryResponse> {
        const userIdentity = serializeUserIdentity(user);
        const query = fromDescriptiveString(queryMessage.query);
        const result = await this.authorization.query(userIdentity, queryMessage.start, query);
        return {
            results: result
        };
    }

    private async load(user: RequestUser, loadMessage: LoadMessage) : Promise<LoadResponse> {
        const userIdentity = serializeUserIdentity(user);
        const result = await this.authorization.load(userIdentity, loadMessage.references);
        return {
            facts: result
        };
    }

    private async save(user: RequestUser, saveMessage: SaveMessage) : Promise<SaveResponse> {
        const userIdentity = serializeUserIdentity(user);
        await this.authorization.save(userIdentity, saveMessage.facts);
        return {};
    }

    private async read(user: RequestUser, input: string): Promise<string> {
        let knownFacts: Declaration = {};
        if (user) {
            const userFact = await this.authorization.getOrCreateUserFact({
                provider: user.provider,
                id: user.id
            });
            knownFacts = {
                me: {
                    fact: userFact,
                    reference: {
                        type: userFact.type,
                        hash: userFact.hash
                    }
                }
            };
        }
        const parser = new SpecificationParser(input);
        parser.skipWhitespace();
        var declaration = parser.parseDeclaration(knownFacts);
        var specification = parser.parseSpecification();

        // Select starting facts that match the inputs
        const start = specification.given.map(input => {
            const fact = declaration[input.name];
            if (!fact) {
                throw new Error(`No fact named ${input.name} was declared`);
            }
            return fact.reference;
        });

        const userIdentity = serializeUserIdentity(user);
        const results = await this.authorization.read(userIdentity, start, specification);
        return JSON.stringify(results, null, 2);
    }

    private write(user: RequestUser, input: string): Promise<string> {
        throw new Error("Method not implemented.");
    }

    private feed(user: RequestUser, input: string): Promise<string> {
        throw new Error("Method not implemented.");
    }
}