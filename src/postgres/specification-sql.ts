import { Specification } from "../specification/specification";
import { FactReference } from "../storage";

export type SpecificationSqlQuery = {
    empty: boolean,
    sql: string,
    parameters: any[],
    pathLength: number,
    factTypeNames: string[]
};

export function sqlFromSpecification(start: FactReference, specification: Specification, factTypes: Map<string, number>, roleMap: Map<number, Map<string, number>>): SpecificationSqlQuery {
    throw new Error("Function not implemented.");
}
