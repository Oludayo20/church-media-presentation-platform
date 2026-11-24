import { Fragment, useEffect, useRef, useState } from "react";
import { Button, Input } from "@cmp/design-system";
import type { BibleBook, BibleTranslation } from "@cmp/shared-types";
import type { ChannelOutput, EngineDocument } from "@cmp/shared-validation";
import { useNavigationStore } from "../../app/stores/navigation-store";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import { errorMessage, unwrap } from "../../lib/ipc";
import { SlidePreview } from "../live/components/EngineViews";
import { useLiveStore } from "../live/live-store";

type SearchResults = ChannelOutput<"bible:search">;

export function BiblePage({
  quick = false,
  onReturn,
}: {
  quick?: boolean;
  onReturn?: () => void;
}) {
  const navigate = useNavigationStore((state) => state.navigate);
  const preferred = useWorkspaceStore(
    (state) => state.settings?.["bible.defaultTranslation"],
  );
  const sessionId = useLiveStore((state) => state.live?.sessionId);
  const overlay = useLiveStore((state) => state.live?.overlay);
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [results, setResults] = useState<{
    key: string;
    data: SearchResults;
  }>();
  const [preview, setPreview] = useState<{
    code: string;
    reference: string;
    doc: EngineDocument;
  }>();
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState<ChannelOutput<"bible:saved">>([]);
  const [collections, setCollections] = useState<
    ChannelOutput<"bible:collections">
  >([]);
  const [collectionId, setCollectionId] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [displayed, setDisplayed] = useState(false);
  const latestPreview = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  async function refreshSaved() {
    const [passages, groups] = await Promise.all([
      unwrap(window.cmp.bible.saved()),
      unwrap(window.cmp.bible.collections()),
    ]);
    setSaved(passages);
    setCollections(groups);
  }

  useEffect(() => {
    let cancelled = false;
    void unwrap(window.cmp.bible.translations())
      .then((items) => {
        if (cancelled) return;
        setTranslations(items);
        setCode(
          (current) =>
            current ||
            items.find((item) => item.code === preferred)?.code ||
            items[0]?.code ||
            "",
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    if (!quick)
      void Promise.all([
        unwrap(window.cmp.bible.saved()),
        unwrap(window.cmp.bible.collections()),
      ])
        .then(([passages, groups]) => {
          if (cancelled) return;
          setSaved(passages);
          setCollections(groups);
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(errorMessage(reason));
        });
    return () => {
      cancelled = true;
    };
  }, [preferred, quick]);

  useEffect(() => {
    if (!code || quick) return;
    let current = true;
    void unwrap(window.cmp.bible.books({ code }))
      .then((items) => {
        if (current) setBooks(items);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, [code, quick]);

  const searchKey = JSON.stringify([code, query.trim()]);
  useEffect(() => {
    if (!code || !query.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      void unwrap(window.cmp.bible.search({ code, query }))
        .then((data) => {
          if (current) setResults({ key: searchKey, data });
        })
        .catch((reason: unknown) => {
          if (current) setError(errorMessage(reason));
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [code, query, searchKey]);

  function updateQuery(value: string) {
    latestPreview.current++;
    setQuery(value);
    setPreview(undefined);
    setError("");
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

  function openPassage(reference: string, translation = code) {
    if (!translation || !reference.trim()) return;
    updateQuery(reference);
    setCode(translation);
    const sequence = latestPreview.current;
    void run(async () => {
      const doc = await unwrap(
        window.cmp.bible.preview({ code: translation, reference }),
      );
      if (sequence !== latestPreview.current) return;
      setPreview({ code: translation, reference, doc });
      setIndex(0);
      if (quick) input.current?.focus();
    });
  }

  function display() {
    if (!preview || !sessionId) return;
    void run(async () => {
      await unwrap(
        window.cmp.bible.show({
          code: preview.code,
          reference: preview.reference,
          sessionId,
        }),
      );
      if (quick) setDisplayed(true);
    });
  }

  function back() {
    if (!displayed || !sessionId) {
      onReturn?.();
      return;
    }
    void run(async () => {
      await unwrap(window.cmp.live.overlayPop());
      onReturn?.();
    });
  }

  const matches = results?.key === searchKey ? results.data : undefined;
  return (
    <section
      className="space-y-4 p-6"
      aria-label={quick ? "Quick Scripture" : "Bible Manager"}
      onKeyDown={(event) => {
        if (quick && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) back();
        }
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">
          {quick ? "Quick Scripture" : "Bible"}
        </h1>
        {quick ? (
          <Button variant="secondary" onClick={back} disabled={busy}>
            {displayed ? "Return to live" : "Close"}
          </Button>
        ) : (
          <Button
            disabled={busy || !!sessionId}
            onClick={() =>
              void run(async () => {
                const installed = await unwrap(window.cmp.bible.install());
                if (!installed) return;
                setTranslations(await unwrap(window.cmp.bible.translations()));
                updateQuery("");
                setCode(installed.code);
              })
            }
          >
            Install translation
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-live">
          {error}
        </p>
      )}
      {translations.length === 0 && (
        <p className="text-muted">
          Install a licensed .cmpbible translation from the Bible module to get
          started.
        </p>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || displayed) return;
          if (quick && preview) display();
          else openPassage(matches?.reference ?? query);
        }}
      >
        <select
          className="rounded border border-border bg-surface px-2"
          aria-label="Bible translation"
          value={code}
          disabled={busy || displayed || !translations.length}
          onChange={(event) => {
            setBooks([]);
            setCode(event.target.value);
            updateQuery(query);
          }}
        >
          {translations.map((translation) => (
            <option key={translation.code} value={translation.code}>
              {translation.name} ({translation.code})
            </option>
          ))}
        </select>
        <Input
          ref={input}
          className="min-w-48 flex-1"
          aria-label="Scripture reference or search terms"
          placeholder="John 3:16 or a phrase"
          value={query}
          maxLength={300}
          readOnly={displayed}
          onChange={(event) => updateQuery(event.target.value)}
        />
        <Button
          type="submit"
          disabled={busy || displayed || !code || !query.trim()}
        >
          {quick && preview ? "Display" : "Preview"}
        </Button>
      </form>
      {!quick && code && (
        <BookBrowser
          key={code}
          code={code}
          books={books}
          openPassage={openPassage}
        />
      )}
      {!displayed && matches && !preview && (
        <ul className="max-h-52 space-y-2 overflow-auto">
          {matches.reference && (
            <li>
              <Button
                variant="secondary"
                onClick={() => openPassage(matches.reference!)}
              >
                {matches.reference}
              </Button>
            </li>
          )}
          {matches.matches.map(({ reference, snippet }) => (
            <li key={reference} className="text-sm">
              <button
                disabled={busy}
                className="w-full rounded border border-border p-2 text-left"
                onClick={() => openPassage(reference)}
              >
                <strong>{reference}</strong>{" "}
                <HighlightedSnippet snippet={snippet} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="space-y-2">
          <SlidePreview
            doc={preview.doc}
            slideIndex={index}
            label="Scripture preview"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!index}
              onClick={() => setIndex(index - 1)}
            >
              Previous preview
            </Button>
            <span>
              {index + 1} / {preview.doc.slides.length}
            </span>
            <Button
              variant="secondary"
              disabled={index + 1 >= preview.doc.slides.length}
              onClick={() => setIndex(index + 1)}
            >
              Next preview
            </Button>
            {displayed && overlay && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy || overlay.slideIndex === 0}
                  onClick={() =>
                    void run(async () => {
                      await unwrap(window.cmp.live.prev());
                    })
                  }
                >
                  Previous on audience
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    busy || overlay.slideIndex + 1 >= overlay.slideCount
                  }
                  onClick={() =>
                    void run(async () => {
                      await unwrap(window.cmp.live.next());
                    })
                  }
                >
                  Next on audience
                </Button>
              </>
            )}
            {!quick && (
              <Button disabled={busy || !sessionId} onClick={display}>
                Show on audience
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy || !sessionId}
              onClick={() => {
                if (sessionId)
                  void run(async () => {
                    await unwrap(
                      window.cmp.bible.queue({
                        code: preview.code,
                        reference: preview.reference,
                        sessionId,
                      }),
                    );
                  });
              }}
            >
              Add to live playlist
            </Button>
            {!quick && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { doc } = await unwrap(
                        window.cmp.bible.copyToPresentation({
                          code: preview.code,
                          reference: preview.reference,
                        }),
                      );
                      navigate("presentations", doc.id);
                    })
                  }
                >
                  Copy to presentation
                </Button>
                <select
                  aria-label="Save passage to"
                  value={collectionId}
                  onChange={(event) => setCollectionId(event.target.value)}
                >
                  <option value="">Favourites</option>
                  {collections.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await unwrap(
                        window.cmp.bible.save({
                          code: preview.code,
                          reference: preview.reference,
                          collectionId: collectionId || null,
                        }),
                      );
                      await refreshSaved();
                    })
                  }
                >
                  Save passage
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {!quick && (
        <div className="space-y-2">
          <h2 className="font-semibold">Saved scripture</h2>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !collectionName.trim()) return;
              void run(async () => {
                await unwrap(
                  window.cmp.bible.createCollection({ name: collectionName }),
                );
                setCollectionName("");
                await refreshSaved();
              });
            }}
          >
            <Input
              aria-label="New collection name"
              value={collectionName}
              maxLength={80}
              onChange={(event) => setCollectionName(event.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={busy || !collectionName.trim()}
            >
              Create collection
            </Button>
          </form>
          <ul className="space-y-2">
            {saved.map((entry) => (
              <li className="flex items-center gap-2" key={entry.id}>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    openPassage(entry.reference, entry.translationCode)
                  }
                >
                  {entry.reference} · {entry.translationCode}
                </Button>
                <span>
                  {collections.find((group) => group.id === entry.collectionId)
                    ?.name ?? "Favourites"}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await unwrap(window.cmp.bible.remove({ id: entry.id }));
                      await refreshSaved();
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HighlightedSnippet({ snippet }: { snippet: string }) {
  return snippet.split("\u0001").map((segment, index) => {
    if (index === 0) return <Fragment key={index}>{segment}</Fragment>;
    const [match, following] = segment.split("\u0002", 2);
    return (
      <Fragment key={index}>
        <mark>{match}</mark>
        {following}
      </Fragment>
    );
  });
}

function BookBrowser({
  code,
  books,
  openPassage,
}: {
  code: string;
  books: BibleBook[];
  openPassage(reference: string): void;
}) {
  const [bookId, setBookId] = useState("");
  const [chapter, setChapter] = useState("");
  const [verse, setVerse] = useState("");
  const [addresses, setAddresses] = useState<ChannelOutput<"bible:addresses">>(
    [],
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (!bookId) return;
    let current = true;
    void unwrap(window.cmp.bible.addresses({ code, bookId: Number(bookId) }))
      .then((items) => {
        if (current) setAddresses(items);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, [bookId, code]);
  const book = books.find(({ id }) => id === Number(bookId));
  const chapters = [...new Set(addresses.map((address) => address.chapter))];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Book"
        value={bookId}
        onChange={(event) => {
          setBookId(event.target.value);
          setChapter("");
          setVerse("");
          setAddresses([]);
          setError("");
        }}
      >
        <option value="">Choose book</option>
        {books.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="Chapter"
        disabled={!chapters.length}
        value={chapter}
        onChange={(event) => {
          setChapter(event.target.value);
          setVerse("");
        }}
      >
        <option value="">Choose chapter</option>
        {chapters.map((number) => (
          <option key={number}>{number}</option>
        ))}
      </select>
      <select
        aria-label="Verse"
        disabled={!chapter}
        value={verse}
        onChange={(event) => setVerse(event.target.value)}
      >
        <option value="">Whole chapter</option>
        {addresses
          .filter((address) => address.chapter === Number(chapter))
          .map((address) => (
            <option key={address.verse}>{address.verse}</option>
          ))}
      </select>
      <Button
        variant="secondary"
        disabled={!book || !chapter}
        onClick={() =>
          book &&
          openPassage(`${book.name} ${chapter}${verse ? `:${verse}` : ""}`)
        }
      >
        Browse passage
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
