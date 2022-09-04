import { Hydration } from '../fact/hydrate';
import { Query } from '../query/query';
import { FactReference, factReferenceEquals } from '../storage';
import { mapAsync } from '../util/fn';
import { ServiceRunner } from '../util/serviceRunner';
import { ObservableSource } from './observable';
import { Trace } from '../util/trace';

export function runService<U>(feed: ObservableSource, start: FactReference, query: Query, serviceRunner: ServiceRunner, handler: (message: U) => Promise<void>) {
    let processing: FactReference[] = [];
    const subscription = feed.from(start, query)
        .subscribe(async (pathsAdded) => {
            const factsAdded = pathsAdded.map(p => p[p.length - 1]);
            const recordsAdded = await feed.load(factsAdded);
            const hydration = new Hydration(recordsAdded);
            await mapAsync(factsAdded, async reference => {
                processing.push(reference);
                try {
                    const fact = <U>hydration.hydrate(reference);
                    await handler(fact);
                }
                catch (x) {
                    // Log and continue.
                    Trace.error(x);
                }
            });
            if (processing.length > 0) {
                throw new Error(
                    `The handler did not remove the processed message from the query '${query.toDescriptiveString()}'. ` +
                    `This process will be duplicated the next time the service is run.`);
            }
        }, async (pathsRemoved) => {
            const factsRemoved = pathsRemoved.map(p => p[p.length - 1]);
            processing = processing.filter(p => !factsRemoved.some(factReferenceEquals(p)));
        }
    );
    return subscription;
}
