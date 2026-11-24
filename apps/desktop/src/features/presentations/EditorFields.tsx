import { COMMON_FAMILIES, useFontsStore } from "../fonts/fonts-store";
import { Input } from "@cmp/design-system";
import type { MediaItem } from "@cmp/shared-types";
import type { Background, SlideObject } from "@cmp/shared-validation";

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <Input
        type="number"
        key={value}
        defaultValue={Number(value.toFixed(2))}
        min={min}
        max={max}
        step="any"
        className="w-24"
        onBlur={(event) => {
          const next = event.target.valueAsNumber;
          if (
            Number.isFinite(next) &&
            next >= min &&
            next <= max &&
            next !== value
          )
            onChange(next);
          else event.target.value = String(Number(value.toFixed(2)));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function MediaSelect({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: MediaItem[];
  onSelect(item: MediaItem): void;
}) {
  return (
    <select
      aria-label={label}
      value=""
      disabled={!items.length}
      onChange={(event) => {
        const item = items.find(({ id }) => id === event.target.value);
        if (item) onSelect(item);
      }}
    >
      <option value="">{label}</option>
      {items.map(({ id, name }) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
}

export function ObjectInspector({
  object,
  onChange,
}: {
  object: SlideObject;
  onChange(object: SlideObject): void;
}) {
  if (object.type === "image" || object.type === "video") {
    return (
      <>
        <label>
          Fit{" "}
          <select
            value={object.fit}
            onChange={(event) =>
              onChange({
                ...object,
                fit: event.target.value === "cover" ? "cover" : "contain",
              })
            }
          >
            <option value="contain">Contain</option>
            <option value="cover">Cover</option>
          </select>
        </label>
        {object.type === "video" &&
          (["loop", "muted"] as const).map((flag) => (
            <label key={flag} className="block">
              <input
                type="checkbox"
                checked={object[flag]}
                onChange={(event) =>
                  onChange({ ...object, [flag]: event.target.checked })
                }
              />{" "}
              {flag === "loop" ? "Loop" : "Mute"}
            </label>
          ))}
      </>
    );
  }
  if (object.type !== "text") return null;
  const update = (style: Partial<typeof object.style>) =>
    onChange({ ...object, style: { ...object.style, ...style } });
  return (
    <>
      <textarea
        aria-label="Object text"
        className="min-h-20 w-full rounded border border-border bg-surface p-2"
        value={object.content}
        maxLength={10000}
        onChange={(event) =>
          onChange({ ...object, content: event.target.value })
        }
      />
      <label>
        Font family{" "}
        <Input
          value={object.style.fontFamily}
          maxLength={200}
          list="font-families"
          onChange={(event) => update({ fontFamily: event.target.value })}
        />
        <FontFamilies />
      </label>
      <NumberField
        label="Font size"
        value={object.style.fontSize}
        min={4}
        max={800}
        onChange={(fontSize) => update({ fontSize })}
      />
      <NumberField
        label="Font weight"
        value={object.style.fontWeight}
        min={100}
        max={900}
        onChange={(fontWeight) =>
          update({ fontWeight: Math.round(fontWeight) })
        }
      />
      <NumberField
        label="Line height"
        value={object.style.lineHeight}
        min={0.5}
        max={4}
        onChange={(lineHeight) => update({ lineHeight })}
      />
      <NumberField
        label="Letter spacing"
        value={object.style.letterSpacing}
        min={-20}
        max={100}
        onChange={(letterSpacing) => update({ letterSpacing })}
      />
      <label className="flex justify-between">
        Text colour{" "}
        <input
          type="color"
          value={object.style.color.slice(0, 7)}
          onChange={(event) => update({ color: event.target.value })}
        />
      </label>
      <label className="flex justify-between">
        Alignment{" "}
        <select
          value={object.style.align}
          onChange={(event) => {
            const align = event.target.value;
            if (align === "left" || align === "center" || align === "right")
              update({ align });
          }}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label>
        Text shadow
        <Input
          value={object.style.shadow ?? ""}
          placeholder="0 2px 4px #000"
          maxLength={200}
          onChange={(event) => {
            const shadow = event.target.value;
            if (/^[\w\s#.,()%-]*$/u.test(shadow))
              update({ shadow: shadow || undefined });
          }}
        />
      </label>
      <NumberField
        label="Outline width"
        value={object.style.outline?.width ?? 0}
        min={0}
        max={40}
        onChange={(width) =>
          update({
            outline: width
              ? { width, color: object.style.outline?.color ?? "#000000" }
              : undefined,
          })
        }
      />
      {object.style.outline && (
        <label>
          Outline colour{" "}
          <input
            type="color"
            value={object.style.outline.color.slice(0, 7)}
            onChange={(event) =>
              update({
                outline: {
                  width: object.style.outline!.width,
                  color: event.target.value,
                },
              })
            }
          />
        </label>
      )}
    </>
  );
}

export function BackgroundInspector({
  background,
  onChange,
  media,
}: {
  background: Background;
  onChange(background: Background): void;
  media: MediaItem[];
}) {
  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={background.type === "color"}
          className="rounded border border-border px-2"
          onClick={() => onChange({ type: "color", value: "#151b28" })}
        >
          Solid
        </button>
        <button
          type="button"
          aria-pressed={background.type === "gradient"}
          className="rounded border border-border px-2"
          onClick={() =>
            onChange({
              type: "gradient",
              angle: 180,
              stops: ["#151b28", "#3c5481"],
            })
          }
        >
          Gradient
        </button>
      </div>
      {background.type === "color" && (
        <label className="flex justify-between">
          Background colour
          <input
            type="color"
            value={background.value.slice(0, 7)}
            onChange={(event) =>
              onChange({ type: "color", value: event.target.value })
            }
          />
        </label>
      )}
      {background.type === "gradient" && (
        <>
          {background.stops.map((stop, index) => (
            <label className="flex justify-between" key={index}>
              Gradient colour {index + 1}
              <input
                type="color"
                value={stop.slice(0, 7)}
                onChange={(event) =>
                  onChange({
                    ...background,
                    stops: background.stops.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  })
                }
              />
            </label>
          ))}
          <NumberField
            label="Gradient angle"
            value={background.angle}
            min={0}
            max={360}
            onChange={(angle) => onChange({ ...background, angle })}
          />
        </>
      )}
      <MediaSelect
        label="Media background"
        items={media}
        onSelect={(asset) => {
          const src = `cmp-media://asset/${asset.id}`;
          onChange(
            asset.mediaType === "video"
              ? { type: "video", src, loop: true, muted: true, fit: "cover" }
              : { type: "image", src, fit: "cover" },
          );
        }}
      />
      {(background.type === "image" || background.type === "video") && (
        <>
          <NumberField
            label="Background blur"
            value={background.blur ?? 0}
            min={0}
            max={40}
            onChange={(blur) => onChange({ ...background, blur })}
          />
          <NumberField
            label="Dark overlay (%)"
            value={(background.overlay ?? 0) * 100}
            min={0}
            max={100}
            onChange={(percent) =>
              onChange({ ...background, overlay: percent / 100 })
            }
          />
          <label>
            Background fit{" "}
            <select
              value={background.fit}
              onChange={(event) =>
                onChange({
                  ...background,
                  fit: event.target.value === "cover" ? "cover" : "contain",
                })
              }
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </label>
          {background.type === "video" &&
            (["loop", "muted"] as const).map((flag) => (
              <label key={flag} className="block">
                <input
                  type="checkbox"
                  checked={background[flag]}
                  onChange={(event) =>
                    onChange({ ...background, [flag]: event.target.checked })
                  }
                />{" "}
                {flag === "loop" ? "Loop background" : "Mute background"}
              </label>
            ))}
        </>
      )}
    </>
  );
}

/** Imported (licensed) fonts first, then common system families. */
function FontFamilies() {
  const fonts = useFontsStore((state) => state.fonts);
  return (
    <datalist id="font-families">
      {fonts.map((font) => (
        <option
          key={font.id}
          value={`"${font.family}", Inter, system-ui, sans-serif`}
        >
          {font.family}
        </option>
      ))}
      {COMMON_FAMILIES.map((family) => (
        <option key={family} value={family} />
      ))}
    </datalist>
  );
}
