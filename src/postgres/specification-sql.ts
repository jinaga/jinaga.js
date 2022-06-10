import { PathCondition, Specification } from "../specification/specification";
import { FactReference } from "../storage";
import { getFactTypeId, getRoleId } from "./maps";

export type SpecificationSqlQuery = {
    empty: boolean,
    sql: string,
    parameters: any[],
    pathLength: number,
    factTypeNames: string[]
};

class QueryBuilder {
    private roleIds: number[] = [];

    constructor(
        private factTypes: Map<string, number>,
        private roleMap: Map<number, Map<string, number>>) { }

    public buildQuery(start: FactReference, specification: Specification): SpecificationSqlQuery {
        const startTypeId = getFactTypeId(this.factTypes, start.type);
        const members = specification.matches.map((match, index) => ({
            name: match.unknown.name,
            index: index+2
        }));
        const hashes = members.map(a => `f${a.index}.hash as hash${a.index}`).join(', ');
        const edges = [
            {
                index: 1,
                roleIndex: 3,
                predecesorMemberIndex: 1,
                successorMemberIndex: 2
            }
        ]
        this.roleIds.push(0);
        const joins = edges.map(edge =>
            ` JOIN public.edge e${edge.index}` +
                ` ON e${edge.index}.predecessor_fact_id = f${edge.predecesorMemberIndex}.fact_id` +
                ` AND e${edge.index}.role_id = $${edge.roleIndex}` +
            ` JOIN public.fact f${edge.successorMemberIndex}` +
                ` ON f${edge.successorMemberIndex}.fact_id = e${edge.index}.successor_fact_id`)
            .join("");
        const whereClause = "";
        const sql = `SELECT ${hashes} FROM public.fact f1${joins} WHERE f1.fact_type_id = $1 AND f1.hash = $2${whereClause}`;

        return {
            empty: false,
            sql,
            parameters: [startTypeId, start.hash, ...this.roleIds],
            pathLength: 1,
            factTypeNames: []
        };
    }
}

export function sqlFromSpecification(start: FactReference, specification: Specification, factTypes: Map<string, number>, roleMap: Map<number, Map<string, number>>): SpecificationSqlQuery {
    const queryBuilder = new QueryBuilder(factTypes, roleMap);
    const query = queryBuilder.buildQuery(start, specification);
    return query;
}
