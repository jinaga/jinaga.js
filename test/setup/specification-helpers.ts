import { Specification, SpecificationParser } from "../../src";

/**
 * Parses a specification string into a Specification object.
 * This is a shared helper function used across test files to avoid code duplication.
 *
 * @param input - The specification string to parse
 * @returns The parsed Specification object
 */
export function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

/**
 * Parses a specification string and returns the parser instance.
 * Useful when you need access to the parser after parsing.
 *
 * @param input - The specification string to parse
 * @returns An object containing both the parsed specification and the parser
 */
export function parseSpecificationWithParser(input: string): { specification: Specification; parser: SpecificationParser } {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    const specification = parser.parseSpecification();
    return { specification, parser };
}