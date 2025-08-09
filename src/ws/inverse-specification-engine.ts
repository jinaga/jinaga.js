import { Specification } from "../specification/specification";
import { ProjectedResult } from "../storage";
import { SpecificationListener } from "../observable/observable";

export type AddListenerFn = (
  specification: Specification,
  onResult: (results: ProjectedResult[]) => Promise<void>
) => SpecificationListener;

export type RemoveListenerFn = (listener: SpecificationListener) => void;

export class InverseSpecificationEngine {
  constructor(
    private readonly addListener: AddListenerFn,
    private readonly removeListener: RemoveListenerFn
  ) {}

  addSpecificationListener(
    specification: Specification,
    onResult: (results: ProjectedResult[]) => Promise<void>
  ): SpecificationListener {
    return this.addListener(specification, onResult);
  }

  removeSpecificationListener(listener: SpecificationListener): void {
    this.removeListener(listener);
  }
}