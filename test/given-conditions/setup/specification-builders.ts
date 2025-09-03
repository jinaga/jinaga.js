import { Specification } from "@src";
import { parseSpecification } from "../../setup/specification-helpers";

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
    return parseSpecification(`
      (office: Office [!E {
        closure: Office.Closed [
          closure = office
        ]
      }]) {
      } => office
    `);
  }

  /**
   * Creates a specification that finds offices that ARE closed
   */
  static officesClosed(): Specification {
    return parseSpecification(`
      (office: Office [E {
        closure: Office.Closed [
          closure = office
        ]
      }]) {
      } => office
    `);
  }

  /**
   * Creates a specification that finds offices that are closed but NOT reopened
   */
  static officesClosedNotReopened(): Specification {
    return parseSpecification(`
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
  }

  /**
   * Creates a specification with multiple givens (company + office)
   */
  static companyOfficesNotClosed(): Specification {
    return parseSpecification(`
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
  }

  /**
   * Creates a specification with no given conditions (backward compatibility)
   */
  static officesNoConditions(): Specification {
    return parseSpecification(`
      (office: Office) {
      } => office
    `);
  }
}

/**
 * Helper to create specifications from raw objects (for testing edge cases)
 */
export function createSpecificationFromObject(spec: any): Specification {
  return spec as Specification;
}