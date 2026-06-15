# `src/next`

Experimental internal architecture spike.

This directory is not a replacement public API and is not exported by the package. It exists to sketch Effect-native internal module shapes before migrating the current implementation behind the existing public API and test suite.

Current focus:

- named Inngest wire scalar codecs;
- schema-backed transformations instead of generic helper functions;
- small modules that can later replace focused pieces of `src/internal`.
