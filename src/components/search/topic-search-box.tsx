"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared topic search box with live autocomplete.
 *
 * - Typing (>= 2 chars) fetches side-effect-free suggestions from
 *   /api/learn/topic-search/suggest (debounced).
 * - Selecting a suggestion (click or Enter on a highlighted row) jumps straight
 *   to that topic: /dashboard/search?q=<title>&topicId=<id>.
 * - Pressing Enter with NO suggestion highlighted runs the text search:
 *   /dashboard/search?q=<text>.
 *
 * Used by both the dashboard home box and the search results page.
 */

interface Suggestion {
  topicId: number;
  title: string;
  chapterTitle: string;
  subjectName: string;
  grade: number;
  boardCode: string;
}

interface TopicSearchBoxProps {
  boardId?: number | null;
  grade?: number | null;
  initialValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Show a spinner in the Search button (e.g. while the page fetches results). */
  loading?: boolean;
  className?: string;
}

export function TopicSearchBox({
  boardId,
  grade,
  initialValue = "",
  placeholder = "Search any topic — e.g. Ohm's law, Photosynthesis, Quadratic equations",
  autoFocus = false,
  loading = false,
  className,
}: TopicSearchBoxProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [fetching, setFetching] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  // True only after the user actually types — keeps the dropdown from
  // auto-opening (and covering results) when the value is set programmatically
  // (initialValue / restore on the results page).
  const typedRef = useRef(false);

  // Keep the input in sync when the page changes the query underneath us.
  useEffect(() => {
    setValue(initialValue);
    typedRef.current = false;
    setOpen(false);
  }, [initialValue]);

  // Prefetch the results route so selecting a topic navigates instantly
  // instead of stalling while the page chunk loads.
  useEffect(() => {
    router.prefetch("/dashboard/search");
  }, [router]);

  // Debounced suggestion fetch — only after the user types (not on
  // programmatic value sync), so the dropdown never covers the results page.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || !typedRef.current) {
      setSuggestions([]);
      setActiveIdx(-1);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (boardId) params.set("boardId", String(boardId));
      if (grade) params.set("grade", String(grade));
      fetch(`/api/learn/topic-search/suggest?${params.toString()}`)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          const s: Suggestion[] = json?.success ? json.data.suggestions ?? [] : [];
          setSuggestions(s);
          setActiveIdx(-1);
          // Re-check typedRef: a fetch that resolves AFTER a navigation (which
          // resets typedRef) must not reopen the dropdown over the results.
          setOpen(typedRef.current && s.length > 0);
        })
        .catch(() => { if (!cancelled) setSuggestions([]); })
        .finally(() => { if (!cancelled) setFetching(false); });
    }, 180);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [value, boardId, grade]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function goToTopic(s: Suggestion) {
    setOpen(false);
    typedRef.current = false;
    setValue(s.title);
    startNavigation(() => {
      router.push(`/dashboard/search?q=${encodeURIComponent(s.title)}&topicId=${s.topicId}`);
    });
  }

  function runTextSearch(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    setOpen(false);
    typedRef.current = false;
    startNavigation(() => {
      router.push(`/dashboard/search?q=${encodeURIComponent(trimmed)}`);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Enter") { e.preventDefault(); runTextSearch(value); }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case "Enter":
        e.preventDefault();
        // Highlighted suggestion → jump to topic; otherwise → text search.
        if (activeIdx >= 0 && activeIdx < suggestions.length) goToTopic(suggestions[activeIdx]);
        else runTextSearch(value);
        break;
      case "Escape":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <form onSubmit={(e) => { e.preventDefault(); runTextSearch(value); }}>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => { typedRef.current = true; setValue(e.target.value); }}
          onFocus={() => { if (typedRef.current && suggestions.length > 0) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search any topic"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="topic-suggestions"
          className="h-12 w-full rounded-full border bg-background pl-12 pr-28 text-sm shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/40"
        />
        <Button
          type="submit"
          size="sm"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-violet-600 hover:bg-violet-700"
        >
          {loading || fetching || navigating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {/* Suggestions dropdown */}
      {open && suggestions.length > 0 && (
        <ul
          id="topic-suggestions"
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-2xl border bg-popover p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.topicId} role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => goToTopic(s)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm",
                  i === activeIdx ? "bg-violet-50 dark:bg-violet-950/40" : "hover:bg-muted"
                )}
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {s.subjectName} · {s.chapterTitle} · Class {s.grade} · {s.boardCode}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {/* Free-text fallback hint */}
          <li className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> Press Enter to search &ldquo;{value.trim()}&rdquo;
            </span>
          </li>
        </ul>
      )}
    </div>
  );
}
