#!/usr/bin/env bun
/**
 * Integration test suite for pkl-zod code generation.
 *
 * Validates that generated TypeScript interfaces compile and Zod schemas:
 *   1. Load without reference errors (schema ordering)
 *   2. Accept valid data (.parse succeeds)
 *   3. Reject invalid data (.parse throws)
 *   4. Infer correct types (structural checks)
 *
 * Usage:
 *   bun tests/run-tests.ts            # run all tests
 *   bun tests/run-tests.ts --generate # regenerate output before testing
 */

import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dir, "..");
const TS_OUT = path.join(ROOT, "test-output", "ts");
const ZOD_OUT = path.join(ROOT, "test-output", "zod");

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e: any) {
    failed++;
    const msg = `  \x1b[31m✗\x1b[0m ${name}: ${e.message}`;
    console.log(msg);
    failures.push(`${name}: ${e.message}`);
  }
}

function skip(name: string, _reason?: string) {
  skipped++;
  console.log(`  \x1b[33m-\x1b[0m ${name} (skipped)`);
}

function section(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function run(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8" });
}

// ---------------------------------------------------------------------------
// Fixtures — map of pkl source to list of entry-point modules
// ---------------------------------------------------------------------------

const ALL_FIXTURES = readdirSync(path.join(ROOT, "tests", "fixtures"))
  .filter((f) => f.endsWith(".pkl"))
  .map((f) => `tests/fixtures/${f}`);

// ---------------------------------------------------------------------------
// Step 0 — Optionally regenerate
// ---------------------------------------------------------------------------

if (process.argv.includes("--generate")) {
  console.log("Regenerating output...");
  run(`rm -rf test-output`);
  const fixtureArgs = ALL_FIXTURES.join(" ");
  run(`pkl run gen.pkl --project-dir . -- ${fixtureArgs} --output-path test-output/ts`);
  run(`pkl run zod/gen.pkl --project-dir . -- ${fixtureArgs} --output-path test-output/zod`);
  console.log("Done.\n");
}

// ---------------------------------------------------------------------------
// Step 1 — TypeScript compilation (tsc --noEmit)
// ---------------------------------------------------------------------------

section("TypeScript compilation");

test("all generated .ts files compile with --strict", () => {
  run(
    `bunx tsc --noEmit --strict --target es2020 --moduleResolution bundler --ignoreConfig ` +
      `test-output/ts/*.ts test-output/ts/**/*.ts ` +
      `test-output/zod/*.ts test-output/zod/**/*.ts`
  );
});

// ---------------------------------------------------------------------------
// Step 2 — Zod schema loading (catches ordering / reference errors)
// ---------------------------------------------------------------------------

section("Zod schema loading");

const zodFiles = readdirSync(ZOD_OUT, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".schema.ts"))
  .sort();

for (const file of zodFiles) {
  test(`loads ${file}`, () => {
    // Dynamic import validates that all schemas resolve at runtime
    run(`bun ${path.join(ZOD_OUT, file)}`);
  });
}

// ---------------------------------------------------------------------------
// Step 3 — Zod parse/reject tests
// ---------------------------------------------------------------------------

section("Zod schema validation — discriminated unions");

// Import schemas dynamically for deep testing
const multipleUnions = await import(path.join(ZOD_OUT, "multipleUnions.schema.ts"));

test("ShapeSchema accepts a valid Circle", () => {
  const result = multipleUnions.ShapeSchema.parse({ kind: "circle", radius: 5.0 });
  assert(result.kind === "circle", "kind should be 'circle'");
  assert(result.radius === 5.0, "radius should be 5.0");
});

test("ShapeSchema accepts a valid Rectangle", () => {
  const result = multipleUnions.ShapeSchema.parse({ kind: "rectangle", width: 10, height: 20 });
  assert(result.kind === "rectangle", "kind should be 'rectangle'");
});

test("ShapeSchema accepts a valid Triangle", () => {
  const result = multipleUnions.ShapeSchema.parse({ kind: "triangle", base: 3, height: 4 });
  assert(result.kind === "triangle", "kind should be 'triangle'");
});

test("ShapeSchema rejects unknown discriminator value", () => {
  let threw = false;
  try {
    multipleUnions.ShapeSchema.parse({ kind: "hexagon", sides: 6 });
  } catch {
    threw = true;
  }
  assert(threw, "should reject unknown kind 'hexagon'");
});

test("ShapeSchema rejects missing discriminator", () => {
  let threw = false;
  try {
    multipleUnions.ShapeSchema.parse({ radius: 5 });
  } catch {
    threw = true;
  }
  assert(threw, "should reject missing 'kind'");
});

test("EventSchema accepts a valid ClickEvent", () => {
  const result = multipleUnions.EventSchema.parse({
    eventType: "click",
    timestamp: "2026-01-01T00:00:00Z",
    x: 100,
    y: 200,
  });
  assert(result.eventType === "click", "eventType should be 'click'");
});

test("EventSchema rejects wrong field types", () => {
  let threw = false;
  try {
    multipleUnions.EventSchema.parse({
      eventType: "click",
      timestamp: "2026-01-01",
      x: "not a number",
      y: 200,
    });
  } catch {
    threw = true;
  }
  assert(threw, "should reject string for x");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — abstract union (AbstractUnion.pkl)");

const abstractUnion = await import(path.join(ZOD_OUT, "abstractUnion.schema.ts"));

test("BaseSchema accepts variant A", () => {
  const result = abstractUnion.BaseSchema.parse({
    type: "A",
    something: "hello",
    valueA: "world",
  });
  assert(result.type === "A", "type should be 'A'");
});

test("BaseSchema accepts variant B", () => {
  const result = abstractUnion.BaseSchema.parse({
    type: "B",
    something: "hello",
    valueB: 42,
  });
  assert(result.type === "B", "type should be 'B'");
});

test("BaseSchema rejects unknown variant", () => {
  let threw = false;
  try {
    abstractUnion.BaseSchema.parse({ type: "C", something: "x" });
  } catch {
    threw = true;
  }
  assert(threw, "should reject unknown type 'C'");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — abstract union with root property (AbstractUnionRoot.pkl)");

const abstractUnionRoot = await import(path.join(ZOD_OUT, "abstractUnionRoot.schema.ts"));

test("AbstractUnionSchema accepts a valid root object with variant A", () => {
  const result = abstractUnionRoot.AbstractUnionSchema.parse({
    something: { type: "typeA", something: "hello", valueA: "world" },
  });
  assert(result.something.type === "typeA", "type should be 'typeA'");
  assert(result.something.valueA === "world", "valueA should be 'world'");
});

test("AbstractUnionSchema accepts a valid root object with variant B", () => {
  const result = abstractUnionRoot.AbstractUnionSchema.parse({
    something: { type: "typeB", something: "hello", valueB: 42 },
  });
  assert(result.something.type === "typeB", "type should be 'typeB'");
  assert(result.something.valueB === 42, "valueB should be 42");
});

test("AbstractUnionSchema rejects unknown discriminator in root property", () => {
  let threw = false;
  try {
    abstractUnionRoot.AbstractUnionSchema.parse({
      something: { type: "typeC", something: "hello" },
    });
  } catch {
    threw = true;
  }
  assert(threw, "should reject unknown type 'typeC'");
});

test("BaseSchema ordering: defined before AbstractUnionSchema", () => {
  assert(abstractUnionRoot.BaseSchema !== undefined, "BaseSchema should be exported");
  assert(abstractUnionRoot.AbstractUnionSchema !== undefined, "AbstractUnionSchema should be exported");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — base class reference (BaseReference.pkl)");

const baseReference = await import(path.join(ZOD_OUT, "baseReference.schema.ts"));

test("AbstractUnionSchema accepts root object referencing Base", () => {
  const result = baseReference.AbstractUnionSchema.parse({
    something: { something: "else" },
  });
  assert(result.something.something === "else", "nested something should be 'else'");
});

test("AbstractUnionSchema rejects missing nested field", () => {
  let threw = false;
  try {
    baseReference.AbstractUnionSchema.parse({ something: {} });
  } catch {
    threw = true;
  }
  assert(threw, "should reject missing 'something' in nested Base");
});

test("BaseSchema ordering: defined before AbstractUnionSchema", () => {
  assert(baseReference.BaseSchema !== undefined, "BaseSchema should be exported");
  assert(baseReference.AbstractUnionSchema !== undefined, "AbstractUnionSchema should be exported");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — deep inheritance");

const deepInheritance = await import(path.join(ZOD_OUT, "deepInheritance.schema.ts"));

test("DocumentSchema requires all ancestor fields", () => {
  const doc = deepInheritance.DocumentSchema.parse({
    id: "doc-1",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    createdBy: "alice",
    updatedBy: "bob",
    title: "My Doc",
    content: "Hello world",
    version: 1,
  });
  assert(doc.id === "doc-1", "id from Base");
  assert(doc.updatedAt === "2026-01-02", "updatedAt from Timestamped");
  assert(doc.createdBy === "alice", "createdBy from Auditable");
  assert(doc.title === "My Doc", "title from Document");
});

test("DocumentSchema rejects missing ancestor field", () => {
  let threw = false;
  try {
    deepInheritance.DocumentSchema.parse({
      // missing id and createdAt from Base
      updatedAt: "2026-01-02",
      createdBy: "alice",
      updatedBy: "bob",
      title: "My Doc",
      content: "Hello",
      version: 1,
    });
  } catch {
    threw = true;
  }
  assert(threw, "should reject missing Base fields");
});

test("TagSchema inherits name from Named", () => {
  const tag = deepInheritance.TagSchema.parse({ name: "urgent", color: "red" });
  assert(tag.name === "urgent", "name from Named");
  assert(tag.color === "red", "color from Tag");
});

test("TagSchema allows null color", () => {
  const tag = deepInheritance.TagSchema.parse({ name: "misc", color: null });
  assert(tag.color === null, "color should be null");
});

test("TagSchema allows missing color", () => {
  const tag = deepInheritance.TagSchema.parse({ name: "misc" });
  assert(tag.color === undefined, "color should be undefined when omitted");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — nullable types");

const nullable = await import(path.join(ZOD_OUT, "nullableEverything.schema.ts"));

test("AllOptionalSchema accepts all null values", () => {
  nullable.AllOptionalSchema.parse({
    name: null,
    age: null,
    active: null,
    score: null,
    tags: null,
    metadata: null,
  });
});

test("AllOptionalSchema accepts all omitted values", () => {
  nullable.AllOptionalSchema.parse({});
});

test("AllOptionalSchema accepts all present values", () => {
  nullable.AllOptionalSchema.parse({
    name: "Alice",
    age: 30,
    active: true,
    score: 95.5,
    tags: ["a", "b"],
    metadata: { key: "val" },
  });
});

test("PartiallyOptionalSchema rejects missing required fields", () => {
  let threw = false;
  try {
    nullable.PartiallyOptionalSchema.parse({ name: "Alice" });
  } catch {
    threw = true;
  }
  assert(threw, "should reject missing required fields (id, email, addresses)");
});

test("NullableElementsSchema accepts null inside lists", () => {
  nullable.NullableElementsSchema.parse({
    names: ["Alice", null, "Bob"],
    scores: { math: 100, english: null },
    mixedList: [true, null, false],
  });
});

// ---------------------------------------------------------------------------
section("Zod schema validation — collection types");

const collections = await import(path.join(ZOD_OUT, "collectionVariants.schema.ts"));

test("SetVariantsSchema accepts sets", () => {
  collections.SetVariantsSchema.parse({
    tags: new Set(["a", "b"]),
    ids: new Set([1, 2, 3]),
    flags: new Set([true, false]),
  });
});

test("PairVariantsSchema accepts tuples", () => {
  collections.PairVariantsSchema.parse({
    stringPair: ["hello", "world"],
    intPair: [1, 2],
    mixedPair: ["name", 42],
    nestedPair: ["key", [1, 2, 3]],
  });
});

test("PairVariantsSchema rejects wrong tuple types", () => {
  let threw = false;
  try {
    collections.PairVariantsSchema.parse({
      stringPair: [1, 2], // should be strings
      intPair: [1, 2],
      mixedPair: ["name", 42],
      nestedPair: ["key", [1]],
    });
  } catch {
    threw = true;
  }
  assert(threw, "should reject wrong tuple element types");
});

test("CollectionCombosSchema accepts nested collections", () => {
  collections.CollectionCombosSchema.parse({
    listOfMaps: [{ a: 1 }, { b: 2 }],
    mapOfLists: { fruits: ["apple", "banana"] },
    setOfPairs: new Set([["a", 1]]),
    listOfSets: [new Set(["x"]), new Set(["y"])],
    mapOfSets: { primes: new Set([2, 3, 5]) },
  });
});

// ---------------------------------------------------------------------------
section("Zod schema validation — special types");

const special = await import(path.join(ZOD_OUT, "specialTypes.schema.ts"));

test("DurationFieldsSchema accepts duration objects", () => {
  special.DurationFieldsSchema.parse({
    timeout: { value: 30, unit: "s" },
    interval: { value: 5, unit: "min" },
    maxRetry: null,
  });
});

test("DataSizeFieldsSchema accepts data size objects", () => {
  special.DataSizeFieldsSchema.parse({
    maxUpload: { value: 100, unit: "mb" },
    diskQuota: { value: 1, unit: "tb" },
    bufferSize: { value: 4096, unit: "b" },
  });
});

test("RegexAndUriSchema accepts regex and uri", () => {
  special.RegexAndUriSchema.parse({
    pattern: /^test/,
    endpoint: "https://example.com/api",
    altPattern: null,
    altEndpoint: null,
  });
});

test("LooseTypesSchema accepts arbitrary data", () => {
  special.LooseTypesSchema.parse({
    anything: { nested: [1, "two", true] },
    flexible: { key1: "value", key2: 42 },
    optionalAny: null,
  });
});

// ---------------------------------------------------------------------------
section("Zod schema validation — integer constraints");

const empty = await import(path.join(ZOD_OUT, "emptyAndMinimal.schema.ts"));

test("KitchenSinkSchema enforces integer constraint", () => {
  let threw = false;
  try {
    empty.KitchenSinkSchema.parse({
      aString: "hi",
      anInt: 3.14, // not an integer!
      aFloat: 1.5,
      aBool: true,
      anInt8: 1,
      anInt16: 1,
      anInt32: 1,
      aUint: 1,
      aUint8: 1,
      aUint16: 1,
      aUint32: 1,
    });
  } catch {
    threw = true;
  }
  assert(threw, "should reject non-integer for anInt");
});

test("KitchenSinkSchema accepts valid integer types", () => {
  empty.KitchenSinkSchema.parse({
    aString: "hello",
    anInt: 42,
    aFloat: 3.14,
    aBool: false,
    anInt8: -128,
    anInt16: 32000,
    anInt32: -2000000,
    aUint: 0,
    aUint8: 255,
    aUint16: 65535,
    aUint32: 4000000000,
  });
});

test("EmptySchema accepts empty object", () => {
  empty.EmptySchema.parse({});
});

test("EmptySchema rejects extra fields in strict mode", () => {
  // z.object() is strict by default in zod 4 — test this
  let threw = false;
  try {
    empty.EmptySchema.strict().parse({ rogue: "field" });
  } catch {
    threw = true;
  }
  assert(threw, "should reject unknown keys in strict mode");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — string literal enums");

const stringLiterals = await import(path.join(ZOD_OUT, "stringLiteralEdgeCases.schema.ts"));

test("HttpMethodSchema accepts valid methods", () => {
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
    stringLiterals.HttpMethodSchema.parse(method);
  }
});

test("HttpMethodSchema rejects invalid method", () => {
  let threw = false;
  try {
    stringLiterals.HttpMethodSchema.parse("TRACE");
  } catch {
    threw = true;
  }
  assert(threw, "should reject 'TRACE'");
});

test("ContentTypeSchema accepts MIME types", () => {
  stringLiterals.ContentTypeSchema.parse("application/json");
  stringLiterals.ContentTypeSchema.parse("text/html");
});

test("MixedCaseSchema preserves casing", () => {
  stringLiterals.MixedCaseSchema.parse("camelCase");
  stringLiterals.MixedCaseSchema.parse("PascalCase");
  stringLiterals.MixedCaseSchema.parse("snake_case");
  stringLiterals.MixedCaseSchema.parse("SCREAMING_SNAKE");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — mixed unions");

const mixedUnions = await import(path.join(ZOD_OUT, "mixedUnions.schema.ts"));

test("StatusSchema accepts valid values", () => {
  for (const s of ["pending", "active", "inactive", "archived"]) {
    mixedUnions.StatusSchema.parse(s);
  }
});

test("StatusSchema rejects invalid value", () => {
  let threw = false;
  try {
    mixedUnions.StatusSchema.parse("deleted");
  } catch {
    threw = true;
  }
  assert(threw, "should reject 'deleted'");
});

test("OptionalUnionsSchema accepts null enum values", () => {
  mixedUnions.OptionalUnionsSchema.parse({ status: null, priority: null });
});

test("OptionalUnionsSchema accepts omitted enum values", () => {
  mixedUnions.OptionalUnionsSchema.parse({});
});

// ---------------------------------------------------------------------------
section("Zod schema validation — non-string map keys");

const nonStringKeys = await import(path.join(ZOD_OUT, "nonStringKeys.schema.ts"));

test("IntKeyedMapSchema accepts integer-keyed records", () => {
  // Zod z.record() expects plain objects, even with numeric keys
  nonStringKeys.IntKeyedMapSchema.parse({
    scores: { 1: "first", 2: "second" },
    positions: { 1: 1.5, 2: 2.5 },
  });
});

test("MixedMapsSchema accepts both key types", () => {
  nonStringKeys.MixedMapsSchema.parse({
    stringKeyed: { a: 1, b: 2 },
    intKeyed: { 1: "one" },
    intToList: { 1: ["a", "b"] },
  });
});

// ---------------------------------------------------------------------------
section("Zod schema validation — name overrides");

const nameOverrides = await import(path.join(ZOD_OUT, "nameOverrides.schema.ts"));

test("renamed schemas are exported under correct names", () => {
  assert(nameOverrides.UserProfileSchema !== undefined, "UserProfileSchema should exist");
  assert(nameOverrides.ServerConfigSchema !== undefined, "ServerConfigSchema should exist");
  assert(nameOverrides.APIResponseSchema !== undefined, "APIResponseSchema should exist");
});

test("renamed fields work in schema", () => {
  const user = nameOverrides.UserProfileSchema.parse({
    id: 1,
    displayName: "Alice",
    emailAddress: "alice@example.com",
  });
  assert(user.displayName === "Alice", "renamed field should parse");
});

// ---------------------------------------------------------------------------
section("Zod schema validation — cross-references");

const selfRef = await import(path.join(ZOD_OUT, "selfReferential.schema.ts"));

test("OrgChartSchema validates nested type references", () => {
  selfRef.OrgChartSchema.parse({
    company: {
      name: "Acme",
      headquarters: { street: "123 Main", city: "Springfield", zip: "12345" },
      branches: [{ street: "456 Oak", city: "Shelbyville", zip: "67890" }],
    },
    employees: [
      {
        name: "Alice",
        company: {
          name: "Acme",
          headquarters: { street: "123 Main", city: "Springfield", zip: "12345" },
          branches: [],
        },
        homeAddress: { street: "789 Elm", city: "Springfield", zip: "12345" },
        title: "Engineer",
      },
    ],
    mainOffice: { street: "123 Main", city: "Springfield", zip: "12345" },
  });
});

// ---------------------------------------------------------------------------
section("Zod schema validation — deep nesting");

const deepNesting = await import(path.join(ZOD_OUT, "deepNesting.schema.ts"));

test("MatrixSchema accepts nested arrays and maps", () => {
  deepNesting.MatrixSchema.parse({
    rows: [[1.0, 2.0], [3.0, 4.0]],
    labels: { row1: ["a", "b"], row2: ["c", "d"] },
    tagIndex: { group1: { tag1: 1, tag2: 2 } },
  });
});

test("CacheConfigSchema accepts triple-nested maps", () => {
  deepNesting.CacheConfigSchema.parse({
    regionCache: { "us-east": { "api": { "key1": "val1" } } },
    priorityQueues: [[[1, 2], [3]], [[4]]],
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(60)}`);
console.log(
  `\x1b[1mResults: ${passed} passed, ${failed} failed, ${skipped} skipped\x1b[0m`
);

if (failures.length > 0) {
  console.log(`\n\x1b[31mFailures:\x1b[0m`);
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
