/**
 * Everything the tools read from an org. Each method returns a shape it has
 * validated, or a failure. Output that does not validate is `unknown`, which is
 * never acknowledgeable and never mapped to expired auth. Writes are not here:
 * they arrive in later phases, through the mod and the runner.
 */
export function isFailure(value) {
    return value !== null && typeof value === 'object' && 'failure' in value;
}
