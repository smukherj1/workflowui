# Technical Design: Eager Prefix Pill Display

## Problem

The prefix indicator pill in `CommandPalette` currently appears only after the user types at least one character **after** the colon (e.g., `name:B`). Typing `name:` alone does not show the pill because the token regex requires `\S+` (one or more non-whitespace characters) after the colon. This delays feedback — the user has already committed to a prefix syntax but gets no visual confirmation until they start typing the value.

The same issue applies to invalid prefixes: `blah:` shows nothing, but `blah:x` shows the red pill.

## Goal

Show the prefix pill immediately when the user types the colon — `name:` should show a `name` pill with an empty value, and `blah:` should show a red invalid-prefix pill.

## Changes

### 1. `TOKEN_RE` regex — `ui/src/components/CommandPalette.tsx`

**Current:**
```
/(\w+):"([^"]*)"?|(\w+):(\S+)|"([^"]*)"|(\S+)/g
```

The second alternative `(\w+):(\S+)` requires at least one non-whitespace character after the colon.

**New:**
```
/(\w+):"([^"]*)"?|(\w+):(\S*)|"([^"]*)"|(\S+)/g
```

Change `\S+` to `\S*` so `name:` (at end of input or followed by whitespace) matches with an empty-string value.

### 2. Prefix visibility checks — `ui/src/components/CommandPalette.tsx`

The rendering condition and filters array use truthy checks (`parsed.name`, `parsed.uri`, etc.) which treat `""` as falsy. These must change to explicit `!== null` checks so that an empty-string value (prefix typed, no value yet) still triggers the pill.

**Current (visibility gate):**
```tsx
{(parsed.name ||
  parsed.uri ||
  parsed.pin ||
  parsed.path ||
  parsed.invalidPrefixes.length > 0) &&
  !showHelp && (
    <PalettePrefixIndicator ... />
  )}
```

**New:**
```tsx
{(parsed.name !== null ||
  parsed.uri !== null ||
  parsed.pin !== null ||
  parsed.path !== null ||
  parsed.invalidPrefixes.length > 0) &&
  !showHelp && (
    <PalettePrefixIndicator ... />
  )}
```

**Current (filters array):**
```tsx
filters={[
  ...(parsed.name ? [{ field: "name", value: parsed.name }] : []),
  ...(parsed.uri ? [{ field: "uri", value: parsed.uri }] : []),
  ...(parsed.pin ? [{ field: "pin", value: parsed.pin }] : []),
  ...(parsed.path ? [{ field: "path", value: parsed.path }] : []),
]}
```

**New:**
```tsx
filters={[
  ...(parsed.name !== null ? [{ field: "name", value: parsed.name }] : []),
  ...(parsed.uri !== null ? [{ field: "uri", value: parsed.uri }] : []),
  ...(parsed.pin !== null ? [{ field: "pin", value: parsed.pin }] : []),
  ...(parsed.path !== null ? [{ field: "path", value: parsed.path }] : []),
]}
```

### 3. `handleRemovePrefix` — `ui/src/components/CommandPalette.tsx`

The prefix-removal function uses truthy checks (`if (parsed.name && field !== "name")`) to decide which prefixes to keep when rebuilding the query string. These must also change to `!== null`.

Additionally, empty-value prefixes must be serialized correctly: `name:` (not `name:""` or omitted).

**Current pattern (repeated for each field):**
```tsx
if (parsed.name && field !== "name")
  parts.push(
    parsed.name.includes(" ")
      ? `name:"${parsed.name}"`
      : `name:${parsed.name}`,
  );
```

**New pattern:**
```tsx
if (parsed.name !== null && field !== "name")
  parts.push(
    parsed.name === ""
      ? "name:"
      : parsed.name.includes(" ")
        ? `name:"${parsed.name}"`
        : `name:${parsed.name}`,
  );
```

### 4. `handleAdvancedSearch` — `ui/src/components/CommandPalette.tsx`

The advanced-search URL builder uses truthy checks (`if (parsed.name)`) to forward prefix values. Empty-string values should **not** be forwarded as URL params (there is no meaningful search term to send). No change needed here — the existing truthy checks are correct for this function.

### 5. Debounced search effect — `ui/src/components/CommandPalette.tsx`

The early-return check `if (!q && !name && !uri && !pin && !path)` correctly treats `""` as no search terms (`!""` is `true`). When the user has typed only `name:` with no value, no API call is made — the pill shows but no search fires. This is the desired behavior. No change needed.

### 6. Pill display — `ui/src/components/PalettePrefixIndicator.tsx`

The pill renders `{field}: {value}`. When `value` is `""`, it displays `name: ` (field name, colon, space, nothing). No change needed — this is acceptable and provides clear feedback.

## Behavioral Summary

| Input | Current | After change |
|---|---|---|
| `name:` | No pill, parsed as bare word | `name` pill (empty value), no API call |
| `name:B` | `name` pill with value `B` | Same (unchanged) |
| `blah:` | No pill, parsed as bare word | Red `blah` pill, no API call |
| `blah:x` | Red `blah` pill | Same (unchanged) |
| `name: pin:abc` | 1 pill (`pin`) | 2 pills (`name` empty, `pin:abc`) |
| `Build` | No pill | Same (unchanged) |

## New & Updated E2E Tests

Add to section `[24] Command Palette — Prefix Syntax` in `tests/e2e-tests-frontend.ts`:

### [24.13] typing `name:` (no value) shows prefix pill immediately

Type `name:` into the palette input. Assert:
- `[data-testid="prefix-indicator"]` is visible
- Exactly 1 `[data-testid="prefix-pill"]` exists
- Pill text contains "name"

### [24.14] typing `blah:` (invalid, no value) shows red pill immediately

Type `blah:` into the palette input. Assert:
- `[data-testid="invalid-prefix"]` is visible
- Pill text contains "blah"

### [24.15] `name: pin:abc` shows two pills (name with empty value, pin with value)

Type `name: pin:abc` into the palette input. Assert:
- `[data-testid="prefix-indicator"]` is visible
- Exactly 2 `[data-testid="prefix-pill"]` elements exist
- One pill text contains "name", the other contains "pin"

### [24.16] clicking × on value-less prefix pill `name:` removes it from input

Type `name: pin:abc` into the palette input. Click × on the pill containing "name". Assert:
- Exactly 1 `[data-testid="prefix-pill"]` remains
- Remaining pill text contains "pin"
- Input value is `pin:abc`

## Files Modified

- `ui/src/components/CommandPalette.tsx` — regex, visibility checks, prefix removal, filters array
- `tests/e2e-tests-frontend.ts` — four new test cases in section [24]
