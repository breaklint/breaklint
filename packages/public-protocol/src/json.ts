export function invalid(): never {
  throw new Error("INVALID_PAYLOAD");
}
export function check(condition: unknown): asserts condition {
  if (!condition) invalid();
}
function unicode(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );
}
/** RFC 8785 permits finite fractions; wire admission requires safe nonnegative integers. */
export function canonicalize(
  value: unknown,
  integersOnly = false,
  maxBytes = 8 * 1048576,
): string {
  const ancestors = new Set<object>();
  let bytes = 0;
  function emit(s: string): string {
    bytes += Buffer.byteLength(s);
    check(bytes <= maxBytes);
    return s;
  }
  function visit(v: unknown, depth: number): string {
    check(depth <= 32);
    if (v === null || typeof v === "boolean") return emit(JSON.stringify(v));
    if (typeof v === "string") {
      check(unicode(v));
      return emit(JSON.stringify(v));
    }
    if (typeof v === "number") {
      check(
        Number.isFinite(v) &&
          (!integersOnly || (Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0))),
      );
      return emit(JSON.stringify(v));
    }
    check(typeof v === "object" && !ancestors.has(v));
    ancestors.add(v);
    const array = Array.isArray(v);
    check(
      Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype) ||
        (!array && Object.getPrototypeOf(v) === null),
    );
    const keys = Reflect.ownKeys(v);
    check(keys.every((k) => typeof k === "string"));
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const k of keys) {
      const d = descriptors[k];
      check(d && "value" in d && (d.enumerable || (array && k === "length")));
    }
    let result: string;
    if (array) {
      check(keys.length === v.length + 1);
      result =
        emit("[") +
        Array.from({ length: v.length }, (_, i) => {
          check(Object.hasOwn(v, i));
          return (i ? emit(",") : "") + visit(v[i], depth + 1);
        }).join("") +
        emit("]");
    } else {
      result =
        emit("{") +
        keys
          .sort()
          .map((k, i) => {
            check(unicode(k));
            return (
              (i ? emit(",") : "") +
              emit(JSON.stringify(k) + ":") +
              visit(descriptors[k]?.value, depth + 1)
            );
          })
          .join("") +
        emit("}");
    }
    ancestors.delete(v);
    return result;
  }
  return visit(value, 0);
}

/** Bounded JSON text admission. Scan before JSON.parse, rejecting duplicate decoded
 * keys and excessive depth before constructing DTOs. UTF-8 decoding is fatal. */
export function parseJson(input: string | Uint8Array, maxBytes: number): unknown {
  check(
    typeof input === "string"
      ? Buffer.byteLength(input) <= maxBytes
      : input.byteLength <= maxBytes,
  );
  let text: string;
  try {
    text =
      typeof input === "string"
        ? input
        : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    return invalid();
  }
  check(unicode(text));
  let i = 0;
  const ws = () => {
    while (/[\t\r\n ]/.test(text[i] ?? "x")) i++;
  };
  function str(): string {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === "\\") i++;
      else if (c === '"') {
        const s: unknown = JSON.parse(text.slice(start, i));
        check(typeof s === "string" && unicode(s));
        return s;
      }
    }
    return invalid();
  }
  function value(depth: number): void {
    check(depth <= 32);
    ws();
    const c = text[i];
    if (c === '"') {
      str();
      return;
    }
    if (c === "{" || c === "[") {
      i++;
      ws();
      const end = c === "{" ? "}" : "]";
      const keys = new Set<string>();
      if (text[i] === end) {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (c === "{") {
          check(text[i] === '"');
          const k = str();
          check(!keys.has(k));
          keys.add(k);
          ws();
          check(text[i++] === ":");
        }
        value(depth + 1);
        ws();
        if (text[i] === end) {
          i++;
          return;
        }
        check(text[i++] === ",");
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i),
      )?.[0];
    check(token);
    i += token.length;
    if (/^-?\d/.test(token)) {
      const n = Number(token);
      check(Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0));
      // Decimal arithmetic, before binary64 rounding, must denote that exact integer.
      const parts = token.toLowerCase().split("e");
      const mantissa = parts[0] ?? "";
      const fraction = mantissa.split(".")[1]?.length ?? 0;
      const shift = Number(parts[1] ?? 0) - fraction;
      const digits = mantissa.replace(".", "").replace(/^0+/, "") || "0";
      if (digits !== "0") {
        check(Math.abs(shift) <= maxBytes);
        if (shift < 0) check(digits.endsWith("0".repeat(-shift)));
        const exact = shift >= 0 ? digits + "0".repeat(shift) : digits.slice(0, shift);
        check(exact === String(n));
      }
    }
  }
  try {
    value(0);
    ws();
    check(i === text.length);
    return JSON.parse(text) as unknown;
  } catch {
    return invalid();
  }
}
