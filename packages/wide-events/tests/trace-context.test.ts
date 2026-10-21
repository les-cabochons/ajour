import { describe, expect, it } from "vitest";
import { decodeTraceparent, encodeTraceparent } from "../trace-context.ts";
import { recordingEmitter } from "./fixtures.ts";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";
const HEADER = `00-${TRACE}-${SPAN}-01`;

describe("W3C traceparent", () => {
  it("encodes and decodes the example from the W3C recommendation", () => {
    expect(decodeTraceparent(HEADER)).toEqual({
      trace_id: TRACE,
      span_id: SPAN,
    });
    expect(encodeTraceparent({ trace_id: TRACE, span_id: SPAN })).toBe(HEADER);
  });

  it("reads a later version's first four fields and ignores the rest", () => {
    expect(decodeTraceparent(`cc-${TRACE}-${SPAN}-01-what-the-future`)).toEqual(
      {
        trace_id: TRACE,
        span_id: SPAN,
      },
    );
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["version ff", `ff-${TRACE}-${SPAN}-01`],
    ["extra fields in version 00", `${HEADER}-extra`],
    ["an all-zero trace ID", `00-${"0".repeat(32)}-${SPAN}-01`],
    ["an all-zero span ID", `00-${TRACE}-${"0".repeat(16)}-01`],
    ["uppercase hex", HEADER.toUpperCase()],
    ["a short trace ID", `00-${TRACE.slice(1)}-${SPAN}-01`],
    ["a non-hex flag", `00-${TRACE}-${SPAN}-0g`],
  ])("rejects %s", (_, header) => {
    expect(decodeTraceparent(header)).toBeUndefined();
  });
});

describe("trace context across runtimes", () => {
  it("starts a unit from an incoming header as a child span of it", () => {
    const { events, recorded } = recordingEmitter();

    events.run(
      "api.request",
      { kind: "request", trigger: "system", parent: HEADER },
      () => {},
    );

    expect(recorded[0]).toMatchObject({
      trace_id: TRACE,
      parent_span_id: SPAN,
    });
    expect(recorded[0]!.span_id).not.toBe(SPAN);
  });

  it("round-trips: the header a unit sends makes the next runtime's unit its child", () => {
    const caller = recordingEmitter();
    const callee = recordingEmitter();

    caller.events.run(
      "backlog.sync",
      { kind: "job", trigger: "user" },
      (sync) => {
        // A nested unit sends the header of the unit it folds into.
        caller.events.run(
          "api.request",
          { kind: "request", trigger: "user" },
          (request) => {
            callee.events.run(
              "backlog.sync",
              {
                kind: "request",
                trigger: "system",
                parent: request.traceparent(),
              },
              () => {},
            );
          },
        );
        expect(decodeTraceparent(sync.traceparent())).toMatchObject({
          trace_id: expect.any(String),
        });
      },
    );

    const [sync] = caller.recorded;
    expect(callee.recorded[0]).toMatchObject({
      trace_id: sync!.trace_id,
      parent_span_id: sync!.span_id,
    });
  });

  it("starts a new trace when the incoming header is invalid", () => {
    const { events, recorded } = recordingEmitter();

    events.run(
      "api.request",
      { kind: "request", trigger: "system", parent: "00-nonsense" },
      () => {},
    );

    expect(recorded[0]!.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(recorded[0]).not.toHaveProperty("parent_span_id");
  });
});
