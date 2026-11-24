import { useEffect, useState } from "react";
import { Button, Input } from "@cmp/design-system";
import {
  textStyleSchema,
  type ChannelOutput,
  type EngineDocument,
  type EngineSlide,
  type SlideObject,
} from "@cmp/shared-validation";
import type { MediaItem } from "@cmp/shared-types";
import { errorMessage, unwrap } from "../../lib/ipc";
import { EditorCanvas } from "./EditorCanvas";
import { useLiveStore } from "../live/live-store";

import {
  BackgroundInspector,
  MediaSelect,
  NumberField,
  ObjectInspector,
} from "./EditorFields";

type Saved = ChannelOutput<"presentations:get">;

export function newSlide(): EngineSlide {
  return {
    id: crypto.randomUUID(),
    background: { type: "color", value: "#151b28" },
    objects: [],
  };
}

export function PresentationEditor({
  initial,
  existing,
  onClose,
}: {
  initial: Saved;
  existing: boolean;
  onClose(): void;
}) {
  const [saved, setSaved] = useState(initial);
  const [id, setId] = useState<string | null>(existing ? initial.doc.id : null);
  const [doc, setDoc] = useState(initial.doc);
  const [past, setPast] = useState<EngineDocument[]>([]);
  const [future, setFuture] = useState<EngineDocument[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [objectId, setObjectId] = useState("");
  const [versions, setVersions] = useState<
    ChannelOutput<"presentations:versions">
  >([]);
  const [restoreVersion, setRestoreVersion] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [safeArea, setSafeArea] = useState(true);
  const [snap, setSnap] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const sessionId = useLiveStore((state) => state.live?.sessionId);
  const selectedIndex = Math.min(slideIndex, doc.slides.length - 1);
  const slide = doc.slides[selectedIndex]!;
  const object = slide.objects.find(({ id }) => id === objectId);
  const changed = doc !== saved.doc;
  const assetOptions = media.filter(({ isMissing }) => !isMissing);

  useEffect(() => {
    let current = true;
    void Promise.all([
      unwrap(window.cmp.media.list({ mediaType: "image", limit: 200 })),
      unwrap(window.cmp.media.list({ mediaType: "video", limit: 200 })),
    ])
      .then(([images, videos]) => {
        if (current) setMedia([...images.items, ...videos.items]);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let current = true;
    void unwrap(window.cmp.presentations.versions({ id }))
      .then((items) => {
        if (current) setVersions(items);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, [id, saved.version]);

  function change(next: EngineDocument) {
    setPast([...past.slice(-49), doc]);
    setFuture([]);
    setDoc(next);
    setNotice("");
  }

  function changeSlide(next: EngineSlide) {
    change({
      ...doc,
      slides: doc.slides.map((item, index) =>
        index === selectedIndex ? next : item,
      ),
    });
  }

  function changeObject(next: SlideObject) {
    changeSlide({
      ...slide,
      objects: slide.objects.map((item) => (item.id === next.id ? next : item)),
    });
  }

  function addObject(asset?: MediaItem) {
    const id = crypto.randomUUID();
    const frame = {
      x: doc.width / 10,
      y: doc.height / 4,
      w: doc.width * 0.8,
      h: doc.height / 2,
    };
    const src = asset ? `cmp-media://asset/${asset.id}` : "";
    const next: SlideObject = !asset
      ? {
          id,
          type: "text",
          frame,
          content: "New text",
          style: textStyleSchema.parse({}),
          role: "body",
        }
      : asset.mediaType === "video"
        ? {
            id,
            type: "video",
            frame,
            src,
            fit: "contain",
            loop: false,
            muted: false,
            autoplay: true,
          }
        : { id, type: "image", frame, src, fit: "contain" };
    changeSlide({ ...slide, objects: [...slide.objects, next] });
    setObjectId(id);
  }

  function moveSlide(offset: number) {
    const target = selectedIndex + offset;
    if (target < 0 || target >= doc.slides.length) return;
    const slides = [...doc.slides];
    slides.splice(selectedIndex, 1);
    slides.splice(target, 0, slide);
    change({ ...doc, slides });
    setSlideIndex(target);
  }

  function moveLayer(offset: number) {
    const objects = [...slide.objects];
    const index = objects.findIndex(({ id }) => id === objectId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= objects.length) return;
    const [selected] = objects.splice(index, 1);
    objects.splice(target, 0, selected!);
    changeSlide({ ...slide, objects });
  }

  function resizeCanvas(width: number, height: number) {
    const sx = width / doc.width;
    const sy = height / doc.height;
    change({
      ...doc,
      width,
      height,
      slides: doc.slides.map((item) => ({
        ...item,
        objects: item.objects.map((layer) => ({
          ...layer,
          frame: {
            x: layer.frame.x * sx,
            y: layer.frame.y * sy,
            w: layer.frame.w * sx,
            h: layer.frame.h * sy,
          },
        })),
      })),
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function accept(result: Saved) {
    setSaved(result);
    setDoc(result.doc);
    setId(result.doc.id);
    setRestoreVersion("");
    setFuture([]);
    setPast([]);
    setNotice(`Saved version ${result.version}`);
  }

  return (
    <fieldset disabled={busy} className="space-y-4">
      {error && (
        <p role="alert" className="text-live">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-muted">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            if (
              (!id || changed) &&
              !window.confirm("Close and discard unsaved changes?")
            )
              return;
            onClose();
          }}
        >
          Back to presentations
        </Button>
        <Input
          className="max-w-xs"
          aria-label="Presentation title"
          value={doc.title}
          maxLength={350}
          onChange={(event) => change({ ...doc, title: event.target.value })}
        />
        <Button
          disabled={busy || !doc.title.trim() || (!!id && !changed)}
          onClick={() =>
            void run(async () => {
              accept(
                await unwrap(
                  window.cmp.presentations.save({
                    id,
                    version: saved.version,
                    doc,
                  }),
                ),
              );
            })
          }
        >
          Save
        </Button>
        <Button
          variant="secondary"
          disabled={!past.length}
          onClick={() => {
            setFuture([doc, ...future]);
            setDoc(past.at(-1)!);
            setPast(past.slice(0, -1));
          }}
        >
          Undo
        </Button>
        <Button
          variant="secondary"
          disabled={!future.length}
          onClick={() => {
            setPast([...past, doc]);
            setDoc(future[0]!);
            setFuture(future.slice(1));
          }}
        >
          Redo
        </Button>
        {id && sessionId && (
          <Button
            variant="secondary"
            disabled={busy || changed}
            onClick={() =>
              void run(async () => {
                await unwrap(window.cmp.presentations.queue({ id, sessionId }));
                setNotice("Added to the live playlist");
              })
            }
          >
            Queue presentation
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => resizeCanvas(1920, 1080)}>
          16:9
        </Button>
        <Button variant="secondary" onClick={() => resizeCanvas(1440, 1080)}>
          4:3
        </Button>
        <NumberField
          label="Canvas width"
          value={doc.width}
          min={320}
          max={7680}
          onChange={(value) => resizeCanvas(Math.round(value), doc.height)}
        />
        <NumberField
          label="Canvas height"
          value={doc.height}
          min={240}
          max={4320}
          onChange={(value) => resizeCanvas(doc.width, Math.round(value))}
        />
        <label>
          <input
            type="checkbox"
            checked={snap}
            onChange={(event) => setSnap(event.target.checked)}
          />{" "}
          Snap to grid
        </label>
        <label>
          <input
            type="checkbox"
            checked={safeArea}
            onChange={(event) => setSafeArea(event.target.checked)}
          />{" "}
          Safe area
        </label>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <EditorCanvas
            doc={doc}
            index={selectedIndex}
            selected={objectId}
            safeArea={safeArea}
            snap={snap}
            onSelect={setObjectId}
            onCommit={(id, frame) => {
              const layer = slide.objects.find((item) => item.id === id);
              if (layer) changeObject({ ...layer, frame });
            }}
          />
          <div className="flex flex-wrap gap-2" aria-label="Slides">
            {doc.slides.map((item, index) => (
              <Button
                key={item.id}
                variant={index === selectedIndex ? "primary" : "secondary"}
                onClick={() => {
                  setSlideIndex(index);
                  setObjectId("");
                }}
              >
                Slide {index + 1}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={doc.slides.length >= 2000}
              onClick={() => {
                change({ ...doc, slides: [...doc.slides, newSlide()] });
                setSlideIndex(doc.slides.length);
              }}
            >
              Add slide
            </Button>
            <Button
              variant="secondary"
              disabled={doc.slides.length >= 2000}
              onClick={() => {
                const slides = [...doc.slides];
                slides.splice(selectedIndex + 1, 0, {
                  ...slide,
                  id: crypto.randomUUID(),
                });
                change({ ...doc, slides });
                setSlideIndex(selectedIndex + 1);
              }}
            >
              Duplicate slide
            </Button>
            <Button
              variant="secondary"
              disabled={selectedIndex === 0}
              onClick={() => moveSlide(-1)}
            >
              Move slide left
            </Button>
            <Button
              variant="secondary"
              disabled={selectedIndex + 1 === doc.slides.length}
              onClick={() => moveSlide(1)}
            >
              Move slide right
            </Button>
            <Button
              variant="ghost"
              disabled={doc.slides.length === 1}
              onClick={() => {
                change({
                  ...doc,
                  slides: doc.slides.filter(
                    (_, index) => selectedIndex !== index,
                  ),
                });
                setSlideIndex(Math.max(0, selectedIndex - 1));
              }}
            >
              Delete slide
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          <fieldset className="space-y-2 rounded border border-border p-3">
            <legend>Slide</legend>
            <BackgroundInspector
              background={slide.background}
              media={assetOptions}
              onChange={(background) => changeSlide({ ...slide, background })}
            />
            <label className="flex justify-between gap-2">
              Transition
              <select
                value={slide.transition?.type ?? "cut"}
                onChange={(event) =>
                  changeSlide({
                    ...slide,
                    transition:
                      event.target.value === "fade"
                        ? { type: "fade", ms: 400 }
                        : { type: "cut", ms: 0 },
                  })
                }
              >
                <option value="cut">Cut</option>
                <option value="fade">Fade</option>
              </select>
            </label>
            {slide.transition?.type === "fade" && (
              <NumberField
                label="Fade (ms)"
                value={slide.transition.ms}
                min={0}
                max={5000}
                onChange={(ms) =>
                  changeSlide({
                    ...slide,
                    transition: { type: "fade", ms: Math.round(ms) },
                  })
                }
              />
            )}
            <NumberField
              label="Duration (ms, 0 for manual)"
              value={slide.durationMs ?? 0}
              min={0}
              max={86_400_000}
              onChange={(value) =>
                changeSlide({
                  ...slide,
                  durationMs: Math.round(value) || undefined,
                })
              }
            />
          </fieldset>
          <fieldset className="space-y-2 rounded border border-border p-3">
            <legend>Objects</legend>
            <Button
              variant="secondary"
              disabled={slide.objects.length >= 200}
              onClick={() => addObject()}
            >
              Add text
            </Button>
            {slide.objects.length < 200 && (
              <MediaSelect
                label="Add image or video"
                items={assetOptions}
                onSelect={addObject}
              />
            )}
            <select
              aria-label="Select object"
              value={object?.id ?? ""}
              onChange={(event) => setObjectId(event.target.value)}
            >
              <option value="">Select a layer</option>
              {slide.objects.map((item, index) => (
                <option value={item.id} key={item.id}>
                  {index + 1}.{" "}
                  {item.type === "text"
                    ? item.content.slice(0, 30) || "Text"
                    : item.type}
                </option>
              ))}
            </select>
            {object && (
              <>
                <div className="flex flex-wrap gap-1">
                  <Button variant="secondary" onClick={() => moveLayer(-1)}>
                    Send back
                  </Button>
                  <Button variant="secondary" onClick={() => moveLayer(1)}>
                    Bring forward
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={slide.objects.length >= 200}
                    onClick={() => {
                      const clone = { ...object, id: crypto.randomUUID() };
                      changeSlide({
                        ...slide,
                        objects: [...slide.objects, clone],
                      });
                      setObjectId(clone.id);
                    }}
                  >
                    Duplicate layer
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      changeSlide({
                        ...slide,
                        objects: slide.objects.filter(
                          (item) => item.id !== objectId,
                        ),
                      })
                    }
                  >
                    Delete layer
                  </Button>
                </div>
                {(["x", "y", "w", "h"] as const).map((key, index) => (
                  <NumberField
                    key={key}
                    label={["X", "Y", "Width", "Height"][index]!}
                    value={object.frame[key]}
                    min={index < 2 ? -7680 : 1}
                    max={15360}
                    onChange={(value) =>
                      changeObject({
                        ...object,
                        frame: { ...object.frame, [key]: value },
                      })
                    }
                  />
                ))}
                <ObjectInspector object={object} onChange={changeObject} />
              </>
            )}
          </fieldset>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!!sessionId || !doc.title.trim()}
          onClick={() =>
            void run(async () => {
              const result = await unwrap(
                window.cmp.presentations.exportDocument({ doc }),
              );
              if (result.saved) setNotice("Presentation exported");
            })
          }
        >
          Export .cmppres
        </Button>
        <Button
          variant="secondary"
          disabled={!!sessionId || !doc.title.trim()}
          onClick={() =>
            void run(async () => {
              const result = await unwrap(
                window.cmp.presentations.exportImages({ doc }),
              );
              if (result.count)
                setNotice(`${result.count} PNG images exported`);
            })
          }
        >
          Export PNGs
        </Button>
        <Button
          variant="secondary"
          disabled={!!sessionId || !doc.title.trim()}
          onClick={() =>
            void run(async () => {
              const result = await unwrap(
                window.cmp.presentations.exportPdf({ doc }),
              );
              if (result.saved) setNotice("PDF exported");
            })
          }
        >
          Export PDF
        </Button>
        <Input
          className="max-w-xs"
          aria-label="Template name"
          value={templateName}
          maxLength={120}
          onChange={(event) => setTemplateName(event.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!templateName.trim() || !doc.title.trim()}
          onClick={() =>
            void run(async () => {
              await unwrap(
                window.cmp.presentations.saveTemplate({
                  name: templateName,
                  doc,
                }),
              );
              setTemplateName("");
              setNotice("Template saved");
            })
          }
        >
          Save as template
        </Button>
      </div>
      {id && versions.length > 1 && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Version to restore"
            value={restoreVersion}
            onChange={(event) => setRestoreVersion(event.target.value)}
          >
            <option value="">Choose a saved version</option>
            {versions
              .filter(({ version }) => version !== saved.version)
              .map(({ version, createdAt }) => (
                <option key={version} value={version}>
                  Version {version} · {new Date(createdAt).toLocaleString()}
                </option>
              ))}
          </select>
          <Button
            variant="secondary"
            disabled={busy || !restoreVersion || changed}
            onClick={() =>
              void run(async () => {
                accept(
                  await unwrap(
                    window.cmp.presentations.restore({
                      id,
                      version: saved.version,
                      restoreVersion: Number(restoreVersion),
                    }),
                  ),
                );
              })
            }
          >
            Restore version
          </Button>
        </div>
      )}
    </fieldset>
  );
}
