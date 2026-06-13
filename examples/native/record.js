process.argv.splice(2, 0, "--runtime", "native");
await import("../record-protocol.js");
