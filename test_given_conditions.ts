import { SpecificationParser } from "./src/specification/specification-parser";
import { describeSpecification } from "./src/specification/description";
import { Specification } from "./src/specification/specification";

// Test parsing a specification with existential conditions on givens
function testExistentialConditionsOnGivens() {
    console.log("Testing existential conditions on givens...");
    
    const input = `
        (office: Corporate.Office [
            !E {
                officeClosure: Corporate.Office.Closure [
                    officeClosure->office: Corporate.Office = office
                ]
            }
        ]) {
            company: Corporate.Company [
                company = office->company: Corporate.Company
            ]
        } => office
    `;
    
    try {
        const parser = new SpecificationParser(input);
        parser.skipWhitespace();
        const specification = parser.parseSpecification();
        
        console.log("Parsed specification:");
        console.log(JSON.stringify(specification, null, 2));
        
        console.log("Description:");
        console.log(describeSpecification(specification, 0));
        
        // Verify the structure
        if (specification.given.length === 1) {
            const given = specification.given[0];
            console.log(`Given: ${given.name}: ${given.type}`);
            console.log(`Conditions count: ${given.conditions.length}`);
            
            if (given.conditions.length === 1) {
                const condition = given.conditions[0];
                console.log(`Condition type: ${condition.type}, exists: ${condition.exists}`);
                console.log(`Matches in condition: ${condition.matches.length}`);
            }
        }
        
        console.log("Test passed!");
        return true;
    } catch (error) {
        console.error("Test failed:", error);
        return false;
    }
}

// Test simple specification without conditions on givens
function testSimpleSpecification() {
    console.log("Testing simple specification...");
    
    const input = `(office: Corporate.Office) {
        company: Corporate.Company [
            company = office->company: Corporate.Company
        ]
    } => office`;
    
    try {
        const parser = new SpecificationParser(input);
        parser.skipWhitespace();
        const specification = parser.parseSpecification();
        
        console.log("Parsed simple specification:");
        console.log(JSON.stringify(specification, null, 2));
        
        console.log("Description:");
        console.log(describeSpecification(specification, 0));
        
        console.log("Simple test passed!");
        return true;
    } catch (error) {
        console.error("Simple test failed:", error);
        return false;
    }
}

// Run tests
if (testSimpleSpecification() && testExistentialConditionsOnGivens()) {
    console.log("All tests passed!");
} else {
    console.log("Some tests failed!");
}