import { expect, it } from "vitest";
import { newId } from "../ids";
import { createPresentationRepository } from "../repositories/presentation-repository";
import { createWorkspaceRepository } from "../repositories/workspace-repository";
import { openMigratedMemoryDb } from "./helpers";

it("saves and restores versioned documents atomically and retains the latest twenty", async () => {
  const database = await openMigratedMemoryDb();
  try {
    const churchId = newId();
    await createWorkspaceRepository(database).createWithOwner({
      churchId,
      churchName: "Test Church",
      ownerDisplayName: "Operator",
    });
    const repo = createPresentationRepository(database, churchId);
    const deck = {
      schemaVersion: "cmp.presentation/v1",
      id: "unsaved",
      title: "Original",
      width: 1920,
      height: 1080,
      slides: [
        {
          id: "first",
          background: { type: "color" as const, value: "#151b28" },
          objects: [
            { id: "title", type: "text" as const, content: "Original text" },
          ],
        },
      ],
    };
    const created = await repo.save(null, 0, deck);
    const id = created.snapshot.id;
    expect(await repo.get(id)).toEqual({
      version: 1,
      snapshot: { ...deck, id },
    });
    const second = await repo.save(id, 1, {
      ...deck,
      title: "Second version",
      width: 1440,
    });
    await expect(repo.save(id, 1, deck)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await repo.get(id)).toEqual(second);
    const original = (await repo.version(id, 1)) as typeof deck;
    expect(await repo.save(id, 2, original)).toEqual({
      version: 3,
      snapshot: { ...deck, id },
    });
    for (let version = 3; version <= 21; version++)
      await repo.save(id, version, deck);
    expect((await repo.versions(id)).map(({ version }) => version)).toEqual(
      Array.from({ length: 20 }, (_, index) => 22 - index),
    );
    await expect(repo.version(id, 2)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const outsider = createPresentationRepository(database, newId());
    await expect(outsider.get(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await outsider.list()).toEqual([]);
  } finally {
    database.close();
  }
});
