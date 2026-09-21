// minimal assert shim (argparse requires it; only hit on internal errors)
function assert(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
assert.ok = assert;
assert.strictEqual = (a, b, msg) => { if (a !== b) throw new Error(msg || `${a} !== ${b}`); };
export default assert;
