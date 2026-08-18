const test = require("node:test");
const assert = require("node:assert/strict");

// The dictation shortcut can be turned OFF from Settings, the orb command menu
// and the tray. These cover the main-process half of that toggle: the OFF state
// must survive as a sentinel the renderer never sees, and turning it back ON
// must restore the key that was live rather than the platform default.

const registered = new Map();
const sent = [];

class FakeWindow {
  constructor() {
    this.webContents = {
      send: (channel, payload) => sent.push({ channel, payload }),
    };
  }
  isDestroyed() {
    return false;
  }
}

const windows = [new FakeWindow()];

require.cache[require.resolve("electron")] = {
  exports: {
    globalShortcut: {
      register(accelerator) {
        if (registered.has(accelerator)) return false;
        registered.set(accelerator, true);
        return true;
      },
      unregister(accelerator) {
        registered.delete(accelerator);
      },
      isRegistered(accelerator) {
        return registered.has(accelerator);
      },
      unregisterAll() {
        registered.clear();
      },
    },
    BrowserWindow: { getAllWindows: () => windows },
  },
};

// Stand-in for EnvironmentManager: the real one mirrors DICTATION_KEY into
// process.env, which is exactly what the disabled check reads.
require.cache[require.resolve("../../src/helpers/environment.js")] = {
  exports: class FakeEnvironmentManager {
    saveDictationKey(key) {
      if (key) process.env.DICTATION_KEY = key;
      else delete process.env.DICTATION_KEY;
      return { success: true };
    }
    getDictationKey() {
      return process.env.DICTATION_KEY;
    }
  },
};

const HotkeyManager = require("../../src/helpers/hotkeyManager.js");
const { DICTATION_HOTKEY_DISABLED } = HotkeyManager;

const noop = () => {};

test.beforeEach(() => {
  registered.clear();
  sent.length = 0;
  delete process.env.DICTATION_KEY;
});

test.after(() => {
  delete process.env.DICTATION_KEY;
});

test("disabling releases the accelerator and persists the OFF sentinel", async () => {
  const manager = new HotkeyManager();

  await manager.updateHotkey("F8", noop);
  assert.equal(manager.isDictationHotkeyDisabled(), false);
  assert.equal(registered.has("F8"), true);

  await manager.disableDictationHotkey();

  assert.equal(registered.has("F8"), false);
  assert.deepEqual(manager.getSlotHotkeys("dictation"), []);
  assert.equal(process.env.DICTATION_KEY, DICTATION_HOTKEY_DISABLED);
  assert.equal(manager.isDictationHotkeyDisabled(), true);
});

test("the renderer is told the shortcut is off, never the raw sentinel", async () => {
  const manager = new HotkeyManager();

  await manager.updateHotkey("F8", noop);
  sent.length = 0;
  await manager.disableDictationHotkey();

  const settings = sent.filter((m) => m.channel === "setting-updated");
  const dictationKey = settings.find((m) => m.payload.key === "dictationKey");
  const disabledFlag = settings.find((m) => m.payload.key === "dictationHotkeyDisabled");

  assert.equal(dictationKey?.payload.value, "");
  assert.equal(disabledFlag?.payload.value, true);
  assert.equal(
    sent.some((m) => JSON.stringify(m.payload ?? "").includes(DICTATION_HOTKEY_DISABLED)),
    false
  );
});

test("re-enabling restores the key that was live, not the platform default", async () => {
  const manager = new HotkeyManager();

  await manager.updateHotkey("F8", noop);
  await manager.disableDictationHotkey();

  assert.equal(manager.getRestoreHotkey(), "F8");

  await manager.updateHotkey(manager.getRestoreHotkey(), noop);

  assert.equal(registered.has("F8"), true);
  assert.equal(process.env.DICTATION_KEY, "F8");
  assert.equal(manager.isDictationHotkeyDisabled(), false);
});

test("with no remembered key, re-enabling falls back to the platform default", () => {
  const manager = new HotkeyManager();

  assert.equal(manager.getRestoreHotkey(), manager.getEffectiveDefaultHotkey());
});

test("an empty key never counts as disabled (that is 'never configured')", () => {
  const manager = new HotkeyManager();

  process.env.DICTATION_KEY = "";
  assert.equal(manager.isDictationHotkeyDisabled(), false);

  process.env.DICTATION_KEY = DICTATION_HOTKEY_DISABLED;
  assert.equal(manager.isDictationHotkeyDisabled(), true);
});
