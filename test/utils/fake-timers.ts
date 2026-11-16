/**
 * Jest's fake timers, installable on the Node this project builds against.
 *
 * `@sinonjs/fake-timers`, which Jest's modern fake timers are built on,
 * installs itself by assigning over the globals it replaces, `performance`
 * among them. Node's test environment defines `performance` as a non-writable
 * own property, so that assignment throws `Cannot assign to read only property
 * 'performance'` and `jest.useFakeTimers()` fails before it has installed
 * anything -- after which every later call in the same file fails with `Can't
 * install fake timers twice`, because the half-installed clock is never torn
 * down.
 *
 * Marking the property writable is enough: the clock then installs and
 * uninstalls normally, and nothing else about the environment changes. The
 * property is left writable afterwards, which is harmless and is what the
 * clock's own uninstall leaves behind in any case.
 */
export function useFakeTimers(): void {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    if (descriptor && descriptor.writable === false && descriptor.configurable) {
        Object.defineProperty(globalThis, 'performance', {
            ...descriptor,
            writable: true
        });
    }
    jest.useFakeTimers();
}
