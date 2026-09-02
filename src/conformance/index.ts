/**
 * The storage conformance kit.
 *
 * This entry point is deliberately separate from `jinaga`'s main entry point:
 * it registers test cases when called, so it must never be reachable from the
 * runtime bundle. Import it as `jinaga/conformance`.
 */
export {
    describeStorageConformance,
    StorageFactory,
    StorageTeardown
} from "./storage-conformance";
