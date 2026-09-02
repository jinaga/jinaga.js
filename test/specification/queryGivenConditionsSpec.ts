import { MemoryStore } from "@src";
import { describeStorageConformance } from "../../src/conformance";

// `MemoryStore.read` delegates to `SpecificationRunner`, the interpreter that
// defines the reference semantics this suite asserts. It is therefore the
// baseline every other implementation is measured against.
describeStorageConformance("MemoryStore", () => new MemoryStore());
