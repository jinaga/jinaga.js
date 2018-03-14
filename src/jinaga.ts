import Interface = require("./interface");
import computeHash = Interface.computeHash;
import { Coordinator } from './coordinator';
import { Instrumentation } from "./instrumentation";
import parse = require("./query/parser");
import MemoryProvider = require("./memory");
import QueryInverter = require("./query/inverter");
import Inverse = QueryInverter.Inverse;
import Collections = require("./collections");
import FactChannel = require("./factChannel");
import _isEqual = Collections._isEqual;
import _some = Collections._some;
import { Proxy, ConditionalSpecification } from './conditional';
import { NetworkProvider } from './network/provider';
import { StorageProvider } from './storage/provider';
import { Query } from './query/query';

class Watch {
    private mappings: { [hash: number]: Array<{ fact: Object, mapping: any }>; } = {};
    private children: Array<Watch> = [];

    constructor(
        public start: Object,
        public joins: Query,
        public resultAdded: (mapping: any, fact: Object) => any,
        public resultRemoved: (mapping: any) => void,
        public inverses: Array<Inverse>,
        public outer: Watch,
        public backtrack: Query
    ) {
    }

    public push(fact: Object, mapping: any) {
        if (!mapping)
            return;
        var hash = computeHash(fact);
        var array = this.mappings[hash];
        if (!array) {
            array = [];
            this.mappings[hash] = array;
        }
        array.push({ fact, mapping });
    }

    public get(fact: Object): any {
        return this.lookup(fact, false);
    }

    public pop(fact: Object): any {
        return this.lookup(fact, true);
    }

    public addChild(child: Watch) {
        this.children.push(child);
    }

    public removeChild(child: Watch) {
        var index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
        }
    }

    public depthFirst(action: (Watch) => void) {
        action(this);
        this.children.forEach((watch) => {
            watch.depthFirst(action);
        });
    }

    public countWatches() {
        return this.children.reduce((i, w) => {
            return i + w.countWatches();
        }, 1);
    }

    private lookup(fact: Object, remove: boolean): any {
        var hash = computeHash(fact);
        var array = this.mappings[hash];
        if (!array)
            return null;
        for(var index = 0; index < array.length; index++) {
            if (_isEqual(array[index].fact, fact)) {
                var mapping = array[index].mapping;
                if (remove)
                    array.splice(index, 1);
                return mapping;
            }
        }
        return null;
    }
}

class JinagaCoordinator implements Coordinator {
    private errorHandlers: Array<(message: string) => void> = [];
    private loadingHandlers: Array<(loading: boolean) => void> = [];
    private progressHandlers: Array<(count: number) => void> = [];
    private watches: Array<Watch> = [];
    private messages: StorageProvider = null;
    private network: NetworkProvider = null;
    private loggedIn: boolean = false;
    private userFact: Object = null;
    private profile: Object = null;
    private loginCallbacks: Array<(userFact: Object, profile: Object) => void> = [];
    private nextToken: number = 1;
    private queries: Array<{ token: number, callback: () => void }> = [];
    private watchCount: number = 0;
    private instrumentationAdapters: Instrumentation[] = [];

    instrument(instrumentation: Instrumentation) {
        this.instrumentationAdapters.push(instrumentation);
    }

    save(storage: StorageProvider) {
        this.messages = storage;
        this.messages.init(this);
        if (this.network)
            this.messages.sendAllFacts();
    }

    sync(network: NetworkProvider) {
        this.network = network;
        this.network.init(this);
        this.messages.sendAllFacts();
    }

    addErrorHandler(callback: (message: string) => void) {
        this.errorHandlers.push(callback);
    }

    addLoadingHandler(callback: (loading: boolean) => void) {
        this.loadingHandlers.push(callback);
    }

    addProgressHandler(callback: (count: number) => void) {
        this.progressHandlers.push(callback);
    }

    fact(message: Object) {
        this.messages.save(message, null);
    }

    watch(
        start: Object,
        outer: Watch,
        templates: Array<(target: Proxy) => Object>,
        resultAdded: (mapping: any, result: Object) => void,
        resultRemoved: (result: Object) => void) : Watch {

        var query = parse(templates);
        var full = outer === null ? query : outer.joins.concat(query);
        var inverses = QueryInverter.invertQuery(full);
        var backtrack = outer === null ? null : QueryInverter.completeInvertQuery(query);
        var watch = new Watch(
            start,
            full,
            resultAdded,
            resultRemoved,
            inverses,
            outer,
            backtrack);
        if (!outer) {
            this.watches.push(watch);
        }
        else {
            outer.addChild(watch);
        }
        this.watchesChanged();

        this.messages.executeQuery(start, full, this.userFact, (_, results) => {
            results.forEach((fact) => {
                if (outer) {
                    this.messages.executeQuery(fact, backtrack, this.userFact, (_, intermediates) => {
                        intermediates.forEach((intermediate) => {
                            var intermediateMapping = outer.get(intermediate);
                            if (intermediateMapping) {
                                this.output(
                                    intermediateMapping,
                                    fact,
                                    watch);
                            }
                        });
                    });
                }
                else {
                    this.output(null, fact, watch);
                }
            });
        });

        if (this.network) {
            let watchFinished = () => {
                this.watchCount--;
                if (this.watchCount === 0) {
                    this.onLoading(false);
                }
            };

            this.queries.push({ token: this.nextToken, callback: watchFinished });
            this.network.watch(start, full, this.nextToken);
            this.nextToken++;
            this.watchCount++;
            if (this.watchCount === 1) {
                this.onLoading(true);
            }
        }
        return watch;
    }

    query(
        start: Object,
        templates: Array<(target: Proxy) => Object>,
        done: (results: Array<Object>) => void
    ) {
        var query = parse(templates);
        var executeQueryLocal = () => {
            this.messages.executeQuery(start, query, this.userFact, (_, results) => {
                done(results);
            });
        };
        if (this.network) {
            this.queries.push({ token: this.nextToken, callback: executeQueryLocal });
            this.network.query(start, query, this.nextToken);
            this.nextToken++;
        }
        else {
            executeQueryLocal();
        }
    }

    removeWatch(watch: Watch) {
        if (watch.outer) {
            watch.outer.removeChild(watch);
        }
        else {
            var index = this.watches.indexOf(watch);
            if (index >= 0) {
                this.watches.splice(index, 1);
            }
        }
        if (this.network) {
            this.network.stopWatch(watch.start, watch.joins);
        }
        this.watchesChanged();
    }

    login(callback: (userFact: Object, profile: Object) => void) {
        if (this.loggedIn) {
            callback(this.userFact, this.profile);
        }
        else if (this.network) {
            this.loginCallbacks.push(callback);
        }
        else {
            callback(null, null);
        }
    }

    onSaved(fact: Object, source: any) {
        if (source === null) {
            this.messages.push(fact);
        }
        this.watches.forEach((root) => {
            root.depthFirst((watch) => {
                watch.inverses.forEach((inverse: Inverse) => {
                    this.messages.executeQuery(fact, inverse.affected, this.userFact, (_, affected) => {
                        if (_some(affected, (obj: Object) => _isEqual(obj, watch.start))) {
                            if (inverse.added && watch.resultAdded) {
                                this.messages.executeQuery(fact, inverse.added, this.userFact, (_, added) => {
                                    added.forEach((fact) => {
                                        if (watch.backtrack) {
                                            this.messages.executeQuery(fact, watch.backtrack, this.userFact, (_, intermediates) => {
                                                intermediates.forEach((intermediate) => {
                                                    var outerMapping = watch.outer.get(intermediate);
                                                    if (outerMapping) {
                                                        this.output(
                                                            outerMapping,
                                                            fact,
                                                            watch);
                                                    }
                                                });
                                            });
                                        }
                                        else {
                                            this.output(null, fact, watch);
                                        }
                                    });
                                });
                            }
                            if (inverse.removed && watch.resultRemoved) {
                                this.messages.executeQuery(fact, inverse.removed, this.userFact, (_, added) => {
                                    added.forEach((fact) => {
                                        var mapping = watch.pop(fact);
                                        if (mapping)
                                            watch.resultRemoved(mapping);
                                    });
                                });
                            }
                        }
                    });
                });
            });
        });
    }

    onReceived(fact: Object, userFact: Object, source: any) {
        this.messages.save(fact, source);
    }

    onDelivered(token:number, destination:any) {
        this.messages.dequeue(token, destination);
    }

    onDone(token: number) {
        var index: number = -1;
        for(var i = 0; i < this.queries.length; i++) {
            var query = this.queries[i];
            if (query.token === token) {
                index = i;
                break;
            }
        }
        if (index >= 0) {
            this.queries.splice(index, 1)[0].callback();
        }
    }

    onLoading(loading: boolean) {
        this.loadingHandlers.forEach(handler => handler(loading));
    }

    onProgress(queueCount:number) {
        this.progressHandlers.forEach(handler => handler(queueCount));
    }

    onError(err: string) {
        this.errorHandlers.forEach(h => h(err));
    }

    send(fact: Object, source: any) {
        if (this.network)
            this.network.fact(fact);
    }

    onLoggedIn(userFact: Object, profile: Object) {
        this.userFact = userFact;
        this.profile = profile;
        this.loggedIn = true;
        this.loginCallbacks.forEach((callback: (userFact: Object, profile: Object) => void) => {
            callback(userFact, profile);
        });
        this.loginCallbacks = [];
    }

    resendMessages() {
        this.messages.sendAllFacts();
    }

    private output(
        parentMapping: any,
        fact: Object,
        watch: Watch
    ) {
        var mapping = watch.resultAdded(parentMapping, fact) || fact;
        watch.push(fact, mapping);
    }

    private watchesChanged() {
        this.instrumentationAdapters.forEach(a => {
            const count = this.watches.reduce((i, w) => {
                return i + w.countWatches();
            }, 0);
            a.setCounter('watches', count);
        });
    }
}

class WatchProxy {
    constructor(
        private _coordinator: JinagaCoordinator,
        private _watch: Watch
    ) { }

    public watch(
        templates: Array<(target: Proxy) => Object>,
        resultAdded: (result: Object) => void,
        resultRemoved: (result: Object) => void) : WatchProxy {
        var nextWatch = this._coordinator.watch(
            this._watch.start,
            this._watch,
            templates,
            resultAdded,
            resultRemoved);
        return new WatchProxy(this._coordinator, nextWatch);
    }

    public stop() {
        if (this._watch) {
            this._coordinator.removeWatch(this._watch);
        }
    }
}

class Jinaga {
    private coordinator: JinagaCoordinator;

    constructor() {
        this.coordinator = new JinagaCoordinator();
        this.coordinator.save(new MemoryProvider());
    }

    public onError(handler: (message: string) => void) {
        this.coordinator.addErrorHandler(handler);
    }
    public onLoading(handler: (loading: boolean) => void) {
        this.coordinator.addLoadingHandler(handler);
    }
    public onProgress(handler: (queueCount: number) => void) {
        this.coordinator.addProgressHandler(handler);
    }
    public instrument(instrumentation: Instrumentation) {
        this.coordinator.instrument(instrumentation);
    }
    public save(storage: StorageProvider) {
        this.coordinator.save(storage);
    }
    public sync(network: NetworkProvider) {
        this.coordinator.sync(network);
    }
    public fact(message: Object): Object {
        var fact = JSON.parse(JSON.stringify(message));
        this.coordinator.fact(fact);
        return fact;
    }
    public watch(
        start: Object,
        templates: Array<(target: Proxy) => Object>,
        resultAdded: (result: Object) => void,
        resultRemoved: (result: Object) => void) : WatchProxy {
        var watch = this.coordinator.watch(
            JSON.parse(JSON.stringify(start)),
            null,
            templates,
            (mapping: any, result: Object) => resultAdded(result),
            resultRemoved);
        return new WatchProxy(this.coordinator, watch);
    }
    public query(
        start: Object,
        templates: Array<(target: Proxy) => Object>,
        done: (result: Array<Object>) => void
    ) {
        this.coordinator.query(JSON.parse(JSON.stringify(start)), templates, done);
    }
    public login(callback: (userFact: Object) => void) {
        this.coordinator.login(callback);
    }
    public preload(cachedFacts: Array<any>) {
        var source = {};
        var channel = new FactChannel(1,
            message => {},
            fact => { this.coordinator.onReceived(fact, null, source); });
        cachedFacts.forEach(cachedFact => {
            channel.messageReceived(cachedFact);
        });
    }

    public where(
        specification: Object,
        conditions: Array<(target: Proxy) => Object>
    ) {
        return new ConditionalSpecification(specification, conditions, true);
    }

    public not(condition: (target: Proxy) => Object): (target: Proxy) => Object;
    public not(specification: Object): Object;
    public not(conditionOrSpecification: any): any {
        if (typeof(conditionOrSpecification) === "function") {
            var condition = <(target: Proxy) => Object>conditionOrSpecification;
            return (t: Proxy) => new Interface.InverseSpecification(condition(t));
        }
        else {
            var specification = <Object>conditionOrSpecification;
            return new Interface.InverseSpecification(specification);
        }
    }
}

export = Jinaga;
