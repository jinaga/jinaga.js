import { Specification } from "../specification/specification";
import { FactReference } from "../storage";
import { FactTypeMap, RoleMap } from "./maps";
import { QueryDescription, SpecificationSqlQuery } from "./query-description";

class ResultDescriptionBuilder {
    constructor(
        private factTypes: FactTypeMap,
        private roleMap: RoleMap
    ) { }

    buildDescriptions(start: FactReference[], specification: Specification): QueryDescription[] {
        throw new Error("Method not implemented.");
    }
}

export function resultSqlFromSpecification(start: FactReference[], specification: Specification, factTypes: FactTypeMap, roleMap: RoleMap): SpecificationSqlQuery[] {
    const descriptionBuilder = new ResultDescriptionBuilder(factTypes, roleMap);
    const descriptions = descriptionBuilder.buildDescriptions(start, specification);

    // Only generate SQL for satisfiable queries.
    return descriptions
        .filter(description => description.isSatisfiable())
        .map(description => description.generateResultSqlQuery());
}
