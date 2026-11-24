import { describe, expect, it, vi } from "vitest";
import { AppError } from "@cmp/shared-types";
import { ipcChannels, IPC_CHANNEL_NAMES } from "@cmp/shared-validation";
import { silentLogger } from "../../logging/logger";
import { createIpcHandlers } from "../handlers";
import {
  assertHandlersMatchRegistry,
  registerIpcRouter,
  type InvokeEventLike,
  type IpcHandlers,
} from "../router";

type Listener = (event: InvokeEventLike, payload: unknown) => Promise<unknown>;

function fakeIpc() {
  const listeners = new Map<string, Listener>();
  return {
    listeners,
    handle: (channel: string, listener: Listener) => {
      listeners.set(channel, listener);
    },
    invoke: (channel: string, payload?: unknown, url = TRUSTED) =>
      listeners.get(channel)!({ senderFrame: { url } }, payload),
  };
}

const TRUSTED = "file:///app/out/renderer/index.html";
const options = {
  isTrustedSender: (url: string) => url === TRUSTED,
  logger: silentLogger,
};

const appInfo = {
  name: "Church Media",
  version: "1.0.0",
  platform: "darwin",
  electron: "45.0.0",
  chrome: "140.0.0",
};

/** A full handler set where every handler is a stub. */
function stubHandlers(overrides: Partial<IpcHandlers> = {}): IpcHandlers {
  const unused = () => {
    throw new Error("not used in this test");
  };
  const base = Object.fromEntries(
    IPC_CHANNEL_NAMES.map((channel) => [channel, unused]),
  ) as unknown as IpcHandlers;
  return { ...base, "app:info": () => appInfo, ...overrides };
}

describe("IPC registry ↔ handlers", () => {
  it("the real handler set covers every channel and nothing else", () => {
    const handlers = createIpcHandlers({
      appInfo: () => appInfo,
      workspaces: {} as never,
      live: {} as never,
      media: {} as never,
      songs: {} as never,
      files: {} as never,
      services: {} as never,
      chooseFontFiles: async () => [],
      bible: {} as never,
      chooseImageFile: async () => null,
      choosePresentationFile: async () => null,
      choosePresentationDestination: async () => null,
      onSettingsChanged: () => {},
    });
    expect(() => assertHandlersMatchRegistry(handlers)).not.toThrow();
    expect(Object.keys(handlers).sort()).toEqual(
      Object.keys(ipcChannels).sort(),
    );
  });

  it("registers one ipcMain handler per schema", () => {
    const ipc = fakeIpc();
    registerIpcRouter(ipc, stubHandlers(), options);
    expect([...ipc.listeners.keys()].sort()).toEqual(
      Object.keys(ipcChannels).sort(),
    );
  });

  it("refuses to start when a channel has no handler", () => {
    const handlers = stubHandlers() as Partial<IpcHandlers>;
    delete handlers["settings:set"];
    expect(() =>
      registerIpcRouter(fakeIpc(), handlers as IpcHandlers, options),
    ).toThrow(/without a handler: \[settings:set\]/);
  });

  it("refuses to start when a handler has no schema", () => {
    const handlers = { ...stubHandlers(), "evil:channel": () => null };
    expect(() =>
      registerIpcRouter(fakeIpc(), handlers as IpcHandlers, options),
    ).toThrow(/without a schema: \[evil:channel\]/);
  });
});

describe("IPC router dispatch", () => {
  it("wraps results in the success envelope", async () => {
    const ipc = fakeIpc();
    registerIpcRouter(ipc, stubHandlers(), options);
    expect(await ipc.invoke("app:info")).toEqual({
      success: true,
      data: appInfo,
    });
  });

  it("rejects an invalid payload with VALIDATION_ERROR and never calls the handler", async () => {
    const ipc = fakeIpc();
    const set = vi.fn();
    registerIpcRouter(ipc, stubHandlers({ "settings:set": set }), options);

    const result = (await ipc.invoke("settings:set", {
      key: "ui.theme",
      value: "purple",
    })) as { success: false; error: { code: string; details: unknown[] } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.details.length).toBeGreaterThan(0);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects unexpected payloads on no-input channels", async () => {
    const ipc = fakeIpc();
    registerIpcRouter(ipc, stubHandlers(), options);
    expect(await ipc.invoke("app:info", { path: "/etc/passwd" })).toMatchObject(
      { success: false, error: { code: "VALIDATION_ERROR" } },
    );
  });

  it("passes the parsed (trimmed) payload to the handler", async () => {
    const ipc = fakeIpc();
    const create = vi.fn(async () => ({ status: "none" as const }));
    registerIpcRouter(
      ipc,
      stubHandlers({ "workspace:create": create }),
      options,
    );
    await ipc.invoke("workspace:create", { churchName: "  Grace  " });
    expect(create).toHaveBeenCalledWith(
      { churchName: "Grace" },
      expect.anything(),
    );
  });

  it("rejects calls from untrusted frames", async () => {
    const ipc = fakeIpc();
    const info = vi.fn(() => appInfo);
    registerIpcRouter(ipc, stubHandlers({ "app:info": info }), options);
    expect(
      await ipc.invoke("app:info", undefined, "https://evil.example"),
    ).toMatchObject({ success: false, error: { code: "INTERNAL" } });
    expect(info).not.toHaveBeenCalled();
  });

  it("maps AppError to its code and message", async () => {
    const ipc = fakeIpc();
    registerIpcRouter(
      ipc,
      stubHandlers({
        "workspace:get": () => {
          throw new AppError("NOT_FOUND", "No workspace is open");
        },
      }),
      options,
    );
    expect(await ipc.invoke("workspace:get")).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "No workspace is open" },
    });
  });

  it("hides unexpected errors behind INTERNAL and logs them", async () => {
    const ipc = fakeIpc();
    const logger = { ...silentLogger, error: vi.fn() };
    registerIpcRouter(
      ipc,
      stubHandlers({
        "workspace:get": () => {
          throw new Error("SQLITE_CORRUPT at /Users/x/secret/path");
        },
      }),
      { ...options, logger },
    );
    const result = await ipc.invoke("workspace:get");
    expect(result).toEqual({
      success: false,
      error: { code: "INTERNAL", message: "workspace:get failed" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(logger.error).toHaveBeenCalled();
  });

  it("refuses results that do not match the output schema", async () => {
    const ipc = fakeIpc();
    registerIpcRouter(
      ipc,
      stubHandlers({
        "workspace:get": () => ({ status: "bogus" }) as never,
      }),
      options,
    );
    expect(await ipc.invoke("workspace:get")).toMatchObject({
      success: false,
      error: { code: "INTERNAL" },
    });
  });
});
