import { describe, expect, it, vi } from "vitest";
import {
  onUpdateCheckRequest,
  requestUpdateCheck,
} from "./update-check-request";

describe("update check requests", () => {
  it("reaches subscribed pages until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onUpdateCheckRequest(listener);

    requestUpdateCheck();
    unsubscribe();
    requestUpdateCheck();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
