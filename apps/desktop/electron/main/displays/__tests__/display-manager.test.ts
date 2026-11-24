import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDisplayProfileRepository,
  createWorkspaceRepository,
  migrate,
  migrations,
  newId,
  openDatabase,
  type Database,
  type DisplayProfileRepository,
} from "@cmp/database";
import { silentLogger } from "../../logging/logger";
import {
  createDisplayManager,
  type DisplayManagerEvents,
} from "../display-manager";
import { FakeScreen, fingerprint, type DisplayLike } from "../screen-source";

const laptop: DisplayLike = {
  id: 1,
  label: "Built-in Retina Display",
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 25, width: 1512, height: 957 },
  scaleFactor: 2,
  internal: true,
};
const projector = {
  id: 7,
  label: "EPSON PJ",
  bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
};

let database: Database;
let profiles: DisplayProfileRepository;
let screen: FakeScreen;
let events: { [K in keyof DisplayManagerEvents]: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  database = openDatabase({ path: ":memory:" });
  await migrate(database.sqlite, migrations);
  const churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({
    churchId,
    churchName: "G",
    ownerDisplayName: "O",
  });
  profiles = createDisplayProfileRepository(database, churchId);
  screen = new FakeScreen(laptop);
  events = {
    changed: vi.fn(),
    audienceLost: vi.fn(),
    audienceAvailable: vi.fn(),
    audienceMoved: vi.fn(),
  };
});
afterEach(() => database.close());

const manager = () =>
  createDisplayManager({
    screen,
    profiles: () => profiles,
    outputResolution: async () => ({ w: 1920, h: 1080 }),
    events: events as unknown as DisplayManagerEvents,
    logger: silentLogger,
  });

describe("fingerprint", () => {
  it("is stable for the same panel and differs across modes", () => {
    const a = screen.add(projector);
    expect(fingerprint(a)).toBe(
      fingerprint({ ...a, id: 99, bounds: { ...a.bounds, x: 0 } }),
    );
    expect(fingerprint(a)).not.toBe(
      fingerprint({ ...a, bounds: { ...a.bounds, width: 1280, height: 720 } }),
    );
  });
});

describe("display manager", () => {
  it("lists displays with physical resolution", () => {
    screen.add(projector);
    const status = manager().status();
    expect(status.displays).toEqual([
      expect.objectContaining({
        id: 1,
        width: 3024,
        height: 1964,
        primary: true,
        internal: true,
        assigned: false,
      }),
      expect.objectContaining({
        id: 7,
        label: "EPSON PJ",
        width: 1920,
        height: 1080,
        primary: false,
      }),
    ]);
    expect(status.audience).toBeNull();
  });

  it("assigns and remembers the audience display", async () => {
    screen.add(projector);
    const displays = manager();
    const status = await displays.assign(7);
    expect(status.audience).toMatchObject({
      displayId: 7,
      name: "EPSON PJ",
      connected: true,
    });
    expect(events.audienceAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
    expect((await profiles.list())[0]).toMatchObject({
      name: "EPSON PJ",
      width: 1920,
      height: 1080,
    });
  });

  it("refuses a display that is not connected", async () => {
    await expect(manager().assign(42)).rejects.toMatchObject({
      code: "DISPLAY_UNAVAILABLE",
    });
  });

  it("reports loss and restores the same projector when it is plugged back in", async () => {
    screen.add(projector);
    const displays = manager();
    await displays.assign(7);
    events.audienceAvailable.mockClear();

    screen.remove(7);
    expect(events.audienceLost).toHaveBeenCalledOnce();
    expect(displays.status().audience).toMatchObject({
      connected: false,
      displayId: null,
    });
    expect(displays.audienceDisplay()).toBeNull();

    // The OS may hand out a new id; the fingerprint still matches.
    screen.add({ ...projector, id: 12 });
    expect(events.audienceAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
    );
    expect(displays.status().audience).toMatchObject({
      connected: true,
      displayId: 12,
    });
    expect(displays.status().newDisplayId).toBeNull();
  });

  it("offers an unknown display instead of switching to it", async () => {
    screen.add(projector);
    const displays = manager();
    await displays.assign(7);
    screen.remove(7);
    screen.add({
      id: 8,
      label: "LED wall",
      bounds: { x: 1512, y: 0, width: 3840, height: 2160 },
    });
    expect(displays.status().newDisplayId).toBe(8);
    expect(displays.status().audience?.connected).toBe(false);
    expect(displays.dismissNew().newDisplayId).toBeNull();
  });

  it("re-assigns a remembered display on start-up, never the primary", async () => {
    screen.add(projector);
    await manager().assign(7);
    const fresh = createDisplayManager({
      screen,
      profiles: () => profiles,
      outputResolution: async () => ({ w: 1920, h: 1080 }),
      events: events as unknown as DisplayManagerEvents,
      logger: silentLogger,
    });
    await fresh.restore();
    expect(fresh.status().audience).toMatchObject({
      displayId: 7,
      connected: true,
    });
    expect(fresh.status().displays.find((d) => d.id === 7)?.known).toBe(true);
  });

  it("follows metrics changes of the audience display", async () => {
    screen.add(projector);
    const displays = manager();
    await displays.assign(7);
    screen.change(7, { bounds: { x: 1512, y: 0, width: 1280, height: 720 } });
    expect(events.audienceMoved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
  });

  it("unassigning reports the output as lost", async () => {
    screen.add(projector);
    const displays = manager();
    await displays.assign(7);
    expect(displays.unassign().audience).toBeNull();
    expect(events.audienceLost).toHaveBeenCalledOnce();
  });
});
