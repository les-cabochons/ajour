/**
 * The cipher of the local API's vault (`apps/api/src/secret-vault.ts`):
 * Electron's `safeStorage`, through its async API only. The sync API goes
 * away in Electron 46, and both fail before `ready`, so the API, which main
 * starts after `ready`, is the only caller.
 *
 * The vault proves encryption itself with a round trip, since
 * `isAsyncEncryptionAvailable()` can say true when encryption will fail.
 * On Linux the `basic_text` backend encrypts with a key every copy of
 * Electron knows, so it counts as unavailable.
 */

/**
 * @param {{
 *   safeStorage: Pick<
 *     import("electron").SafeStorage,
 *     "encryptStringAsync" | "decryptStringAsync" | "getSelectedStorageBackend"
 *   >,
 *   platform: NodeJS.Platform,
 * }} options
 */
function createSafeStorageCipher({ safeStorage, platform }) {
  return {
    async unavailableReason() {
      if (
        platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text"
      ) {
        return "No secret store is available on this computer, such as GNOME Keyring or KWallet.";
      }
      return undefined;
    },
    /** @param {string} text */
    async encrypt(text) {
      return await safeStorage.encryptStringAsync(text);
    },
    /** @param {Uint8Array} ciphertext */
    async decrypt(ciphertext) {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
        Buffer.from(ciphertext),
      );
      return { text: result, reEncrypt: shouldReEncrypt === true };
    },
  };
}

module.exports = { createSafeStorageCipher };
