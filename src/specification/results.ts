import { ProjectedResult } from "../storage";
import { Projection } from "./specification";

/**
 * Unwrap one raw projected result into the shape a caller sees.
 *
 * A composite projection's nested specification components arrive from the
 * store as `ProjectedResult[]`, which is an internal shape. Extraction
 * replaces each with the array of extracted child results, so that every
 * public surface — `query`, `queryRows`, and the `observeChanges` payload —
 * delivers the same value for the same projection.
 */
export function extractResult(raw: any, projection: Projection): { result: any, count: number } {
    if (projection.type !== "composite") {
        return { result: raw, count: 1 };
    }

    let count = 1;
    const obj: any = {};
    for (const component of projection.components) {
        const value = raw[component.name];
        if (component.type === "specification") {
            const { results, totalCount } = extractResults(value, component.projection);
            obj[component.name] = results;
            count += totalCount;
        }
        else {
            obj[component.name] = value;
        }
    }
    return { result: obj, count };
}

export function extractResults(projectedResults: ProjectedResult[], projection: Projection): { results: any[], totalCount: number } {
    const results: any[] = [];
    let totalCount = 0;
    for (const projectedResult of projectedResults) {
        const { result, count } = extractResult(projectedResult.result, projection);
        results.push(result);
        totalCount += count;
    }
    return { results, totalCount };
}
