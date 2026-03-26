# pkl-typescript

PKL code generators for TypeScript and Zod, built entirely in PKL. Generate type-safe TypeScript interfaces and Zod validation schemas from your PKL configuration modules.

## Install

Use the package directly via its `package://` URI — no installation needed:

```bash
pkl run "package://pkg.pkl-lang.org/github.com/bmurray/pkl-typescript/pkl.typescript@0.2.2#/gen.pkl" \
  -- MyConfig.pkl --output-path ./generated
```

## Usage

### Generate TypeScript Interfaces

```bash
pkl run "package://pkg.pkl-lang.org/github.com/bmurray/pkl-typescript/pkl.typescript@0.2.2#/gen.pkl" \
  -- path/to/MyModule.pkl --output-path ./generated
```

### Generate Zod Schemas

```bash
pkl run "package://pkg.pkl-lang.org/github.com/bmurray/pkl-typescript/pkl.typescript@0.2.2#/zod/gen.pkl" \
  -- path/to/MyModule.pkl --output-path ./generated
```

### Options

| Flag | Description |
|------|-------------|
| `--output-path` | Directory to write generated files (default: current directory) |
| `--dry-run` | Print filenames without writing files |
| `--generator-settings` | Path to a custom generator settings file |

### Auto-Discovery

You only need to pass the root module. The generator automatically discovers all imported modules and generates files for each one, preserving directory structure:

```bash
# Just pass the root — imports are followed automatically
pkl run .../gen.pkl -- ServiceConfig.pkl --output-path ./generated
```

Output:
```
generated/
├── serviceConfig.pkl.ts
└── common/
    ├── auth.pkl.ts
    └── types.pkl.ts
```

## Example

Given a PKL module:

```pkl
module myapp.Config

class AppConfig {
  host: String
  port: Int
  debug_mode: Boolean
  tags: List<String>
  metadata: Mapping<String, String>
}

typealias Environment = "development" | "staging" | "production"
```

**TypeScript output** (`config.pkl.ts`):

```typescript
// Code generated from Pkl module `myapp.Config`. DO NOT EDIT.

export type Environment =
  | "development"
  | "staging"
  | "production"
;

export interface AppConfig {
  host: string;
  port: number;
  debugMode: boolean;
  tags: string[];
  metadata: Record<string, string>;
}
```

**Zod output** (`config.schema.ts`):

```typescript
// Code generated from Pkl module `myapp.Config`. DO NOT EDIT.

import { z } from "zod";

export const EnvironmentSchema = z.enum(["development", "staging", "production"]);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const AppConfigSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  debugMode: z.boolean(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.string()),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
```

## Type Mapping

| PKL Type | TypeScript | Zod |
|----------|-----------|-----|
| `String` | `string` | `z.string()` |
| `Boolean` | `boolean` | `z.boolean()` |
| `Int`, `Int8`–`Int32` | `number` | `z.number().int()` |
| `UInt`, `UInt8`–`UInt32` | `number` | `z.number().int().nonnegative()` |
| `Float`, `Number` | `number` | `z.number()` |
| `List<T>`, `Listing<T>` | `T[]` | `z.array(schema)` |
| `Set<T>` | `Set<T>` | `z.set(schema)` |
| `Map<K,V>`, `Mapping<K,V>` | `Record<K, V>` | `z.record(key, val)` |
| `Pair<A,B>` | `[A, B]` | `z.tuple([a, b])` |
| `Duration`, `DataSize` | `{ value: number; unit: string }` | `z.object({ value: z.number(), unit: z.string() })` |
| `T?` (nullable) | `T \| null` | `schema.nullable()` |
| `A \| B` (union) | `A \| B` | `z.union([a, b])` |
| String literal union | `"a" \| "b"` | `z.enum(["a", "b"])` |
| `Any` | `unknown` | `z.unknown()` |
| `Dynamic` | `Record<string, unknown>` | `z.record(z.string(), z.unknown())` |
| Class | `interface` | `z.object({ ... })` |
| Class extends Parent | `interface extends Parent` | `ParentSchema.extend({ ... })` |
| `@ts.Union` abstract class | `type = A \| B` | `z.discriminatedUnion(key, [...])` |

## Annotations

Override generated names or types with `@ts.Name` and `@ts.Type`:

```pkl
import "package://pkg.pkl-lang.org/github.com/bmurray/pkl-typescript/pkl.typescript@0.2.2#/ts.pkl"

@ts.Name { value = "UserProfile" }
class User_Profile {
  @ts.Name { value = "firstName" }
  first_name: String

  @ts.Type { value = "Date" }
  created_at: String
}
```

### Discriminated Unions with `@ts.Union`

Mark an abstract class with `@ts.Union` to generate a discriminated union type instead of an interface. Each child class must narrow the discriminator field using a **type annotation** (`: "value"`), not a value assignment (`= "value"`).

```pkl
import "package://pkg.pkl-lang.org/github.com/bmurray/pkl-typescript/pkl.typescript@0.2.2#/ts.pkl"

@ts.Union { discriminator = "kind" }
abstract class Shape {
  kind: String
}

class Circle extends Shape {
  kind: "circle"
  radius: Float
}

class Rectangle extends Shape {
  kind: "rectangle"
  width: Float
  height: Float
}
```

**TypeScript output:**

```typescript
export interface Circle {
  kind: "circle";
  radius: number;
}

export interface Rectangle {
  kind: "rectangle";
  width: number;
  height: number;
}

export type Shape = Circle | Rectangle;
```

**Zod output:**

```typescript
export const CircleSchema = z.object({
  kind: z.literal("circle"),
  radius: z.number(),
});
export type Circle = z.infer<typeof CircleSchema>;

export const RectangleSchema = z.object({
  kind: z.literal("rectangle"),
  width: z.number(),
  height: z.number(),
});
export type Rectangle = z.infer<typeof RectangleSchema>;

export const ShapeSchema = z.discriminatedUnion("kind", [CircleSchema, RectangleSchema]);
export type Shape = z.infer<typeof ShapeSchema>;
```

The discriminator field can also use a typealias:

```pkl
typealias ShapeKind = "circle" | "rectangle"

@ts.Union { discriminator = "kind" }
abstract class Shape {
  kind: ShapeKind
}

class Circle extends Shape {
  kind: "circle"
  radius: Float
}
```

> **Note:** Child classes must use type annotations (`kind: "circle"`) to narrow the discriminator. Value assignments (`kind = "circle"`) will produce a clear error, because Pkl's reflection doesn't expose default values.

## Using as a Project Dependency

Add to your `PklProject`:

```pkl
amends "pkl:Project"

dependencies {
  ["pkl.typescript"] {
    uri = "package://pkg.pkl-lang.org/github.com/bmurray/pkl-typescript/pkl.typescript@0.2.2"
  }
}
```

Then resolve and run:

```bash
pkl project resolve
pkl run @pkl.typescript/gen.pkl -- MyModule.pkl --output-path ./generated
```

## License

MIT
