import { SpecificationParser } from "../src/specification/specification-parser";
import { describeSpecification } from "../src/specification/description";

// Test parsing a simple specification first
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
        console.log("Given:", specification.given);
        console.log("Test passed!");
        return true;
    } catch (error) {
        console.error("Simple test failed:", error);
        return false;
    }
}

testSimpleSpecification();