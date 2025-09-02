import { Specification } from "../../../../src/specification/specification";
import { SpecificationParser } from "../../../../src/specification/specification-parser";

/**
 * Specification templates using the SpecificationParser for parsing text-based specifications
 */

/**
 * Pre-built specification templates for common test scenarios
 */
export class SpecificationTemplates {
  /**
   * Creates a specification that finds offices that are NOT closed
   */
  static officesNotClosed(): Specification {
    const parser = new SpecificationParser(`
      (office: Office [!E {
        closure: Office.Closed [
          closure = office
        ]
      }]) {
      } => office
    `);
    return parser.parseSpecification();
  }

  /**
   * Creates a specification that finds offices that ARE closed
   */
  static officesClosed(): Specification {
    const parser = new SpecificationParser(`
      (office: Office [E {
        closure: Office.Closed [
          closure = office
        ]
      }]) {
      } => office
    `);
    return parser.parseSpecification();
  }

  /**
   * Creates a specification that finds offices that are closed but NOT reopened
   */
  static officesClosedNotReopened(): Specification {
    const parser = new SpecificationParser(`
      (office: Office [E {
        closure: Office.Closed [
          closure = office
          !E {
            reopening: Office.Reopened [
              reopening = closure
            ]
          }
        ]
      }]) {
      } => office
    `);
    return parser.parseSpecification();
  }

  /**
   * Creates a specification with multiple givens (company + office)
   */
  static companyOfficesNotClosed(): Specification {
    const parser = new SpecificationParser(`
      (company: Company, office: Office [!E {
        closure: Office.Closed [
          closure = office
        ]
      }]) {
      } => {
        company = company
        office = office
      }
    `);
    return parser.parseSpecification();
  }

  /**
   * Creates a specification with no given conditions (backward compatibility)
   */
  static officesNoConditions(): Specification {
    const parser = new SpecificationParser(`
      (office: Office) {
      } => office
    `);
    return parser.parseSpecification();
  }
}

/**
 * Helper to create specifications from raw objects (for testing edge cases)
 */
export function createSpecificationFromObject(spec: any): Specification {
  return spec as Specification;
}