// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { DeckAgentConsent } from "@ajour/shared/deck";
import * as api from "@/lib/app-api";
import {
  DECK_CONSENT_REVOKED_STORAGE_KEY,
  watchDeckConsentRevocations,
} from "@/lib/deck-consent-revocations";
import { installDomShims } from "@/test-support/dom";
import { DeckConsentsSetting } from "./deck-consents-setting";

/*
 * Settings › Agents › Questions about pull requests (#791): Revoke takes a
 * repository's consent back, and every window's review page hears it, so
 * its answers show no more (#790's retained asks). The local API is mocked.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  getDeckConsents: vi.fn(),
  revokeDeckConsent: vi.fn(),
}));

beforeAll(installDomShims);
afterEach(cleanup);

const BILLING: DeckAgentConsent = {
  pluginId: "github",
  connectionId: "work",
  repository: "acme/billing-api",
  cli: "claude-code",
  consentedAt: 0,
};

it("tells this window and the others that a revoked repository asks again", async () => {
  vi.mocked(api.getDeckConsents).mockResolvedValue({ consents: [BILLING] });
  vi.mocked(api.revokeDeckConsent).mockResolvedValue({ consents: [] });
  const heard = vi.fn();
  const stop = watchDeckConsentRevocations(heard);
  try {
    render(<DeckConsentsSetting />);
    fireEvent.click(await screen.findByRole("button", { name: /Revoke/ }));

    await screen.findByText(/None yet/);
    expect(heard).toHaveBeenCalledWith({
      pluginId: "github",
      connectionId: "work",
      repository: "acme/billing-api",
      at: expect.any(Number),
    });
    // Other windows hear it through storage: the repository, never an answer.
    expect(
      JSON.parse(localStorage.getItem(DECK_CONSENT_REVOKED_STORAGE_KEY)!),
    ).toMatchObject({
      pluginId: "github",
      connectionId: "work",
      repository: "acme/billing-api",
    });
  } finally {
    stop();
  }
});
