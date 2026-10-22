import { ZodError } from "zod";

/**
 * Errors as the local API's events may hold them. A validation message lists
 * what failed with the values it received: a caller's text, a plugin's
 * result, a spreadsheet's headings. Such an error reaches an event as its
 * type and a code, with no message. Any other error passes, for the scrubber.
 */

function typeOf(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function codeOf(error: unknown) {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** An error with a type and a code, and no message. */
function standIn(type: string, code: string): Error {
  const error = Object.assign(new Error(""), { code });
  error.name = type;
  return error;
}

/**
 * A request Ajour can't read: a body that isn't JSON or is too large, a
 * malformed path segment, or values the route's schema refuses. Its message
 * is the cause's, for the caller. The request is refused with
 * `invalid_request`.
 */
export class InvalidRequestError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "The request is not valid.",
      { cause },
    );
    this.name = "InvalidRequestError";
  }
}

/**
 * A plugin result that breaks its contract, such as a schema plugin's
 * dataset that its definition doesn't declare. Its message is the
 * validation's, for the user. The operation ends with `invalid_result`.
 */
export class InvalidPluginResultError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "The plugin's result is not valid.",
      { cause },
    );
    this.name = "InvalidPluginResultError";
  }
}

/**
 * A request's body stream that failed while Ajour read it, such as when
 * its client hung up. Only such an error, from the request's own stream, is
 * the client's leaving rather than a failure.
 */
export class RequestBodyInterrupted extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "The request body stopped.",
      { cause },
    );
    this.name = "RequestBodyInterrupted";
  }
}

/** Runs `read`, and turns what it throws into an `InvalidRequestError`. */
export function readInput<Value>(read: () => Value): Value {
  try {
    return read();
  } catch (error) {
    throw error instanceof InvalidRequestError
      ? error
      : new InvalidRequestError(error);
  }
}

/** An error as an event may hold it. */
export function withoutContent(error: unknown): unknown {
  if (error instanceof InvalidRequestError) {
    return standIn(
      typeOf(error.cause),
      codeOf(error.cause) === "invalid_json"
        ? "invalid_json"
        : "invalid_request",
    );
  }
  if (error instanceof InvalidPluginResultError) {
    return standIn(typeOf(error.cause), "invalid_result");
  }
  if (error instanceof ZodError) return standIn("ZodError", "invalid_value");
  return error;
}
