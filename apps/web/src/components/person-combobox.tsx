import { useEffect, useRef, useState } from "react";
import type { BacklogPerson } from "@ajour/shared";
import { RiArrowDownSLine, RiUserLine as PersonIcon } from "@remixicon/react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { personInitials } from "@/domain/backlog/comments";

/** How long typing pauses before a search, as the @ suggestions wait. */
const SEARCH_DELAY_MS = 200;
const UNASSIGNED = "\u0000unassigned";

export interface PersonComboboxProps {
  id?: string;
  /**
   * The picked person, null for Unassigned, or undefined to keep whoever
   * has it while that isn't known.
   */
  value: BacklogPerson | null | undefined;
  onChange: (person: BacklogPerson | null) => void;
  /** Who has it now, listed right after Unassigned. */
  current?: BacklogPerson | null;
  /** The people a name finds. An empty query lists the likely ones. */
  search: (query: string) => Promise<BacklogPerson[]>;
  disabled?: boolean;
  "aria-label"?: string;
  /**
   * A composer chip: the person, or the person icon and "Assignee" while no
   * one is picked, with no chevron (forms council round 19).
   */
  chip?: boolean;
}

interface Results {
  searching: boolean;
  people: BacklogPerson[];
}

/**
 * Picks one person, or Unassigned, from a search the caller runs, such as a
 * plugin's assignees. The list loads when it opens, and each name typed
 * searches again; it keeps its last answer while a search runs.
 */
export function PersonCombobox({
  id,
  value,
  onChange,
  current,
  search,
  disabled = false,
  "aria-label": ariaLabel,
  chip = false,
}: PersonComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({
    searching: false,
    people: [],
  });
  // Only the latest search answers; an older one that ends later is dropped.
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const request = ++latest.current;
    setResults((previous) => ({ ...previous, searching: true }));
    const timer = window.setTimeout(
      () => {
        search(query.trim()).then(
          (people) => {
            if (latest.current === request) {
              setResults({ searching: false, people });
            }
          },
          () => {
            if (latest.current === request) {
              setResults({ searching: false, people: [] });
            }
          },
        );
      },
      query.trim() ? SEARCH_DELAY_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [open, query, search]);

  const typed = query.trim() !== "";
  // Unassigned, then who has it and who was picked, then the answer.
  const pinned = typed
    ? []
    : [current, value].filter(
        (person, index, all): person is BacklogPerson =>
          Boolean(person) &&
          all.findIndex((other) => other?.id === person?.id) === index,
      );
  const people = [
    ...pinned,
    ...results.people.filter(
      (person) => !pinned.some((other) => other.id === person.id),
    ),
  ];

  function pick(person: BacklogPerson | null) {
    onChange(person);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        id={id}
        role="combobox"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          chip
            ? "composer-pill disabled:opacity-50"
            : "flex h-[var(--control-height-lg)] w-full items-center justify-between gap-1.5 rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 py-1 text-[length:var(--control-font-size)] leading-[var(--control-line-height)] whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
        )}
      >
        {chip ? (
          value ? (
            <>
              <PersonInitials name={value.displayName} />
              <span className="truncate">{value.displayName}</span>
            </>
          ) : (
            <>
              <PersonIcon
                aria-hidden
                className="size-3.5 text-muted-foreground"
              />
              <span data-placeholder="">
                {value === null ? "Unassigned" : "Assignee"}
              </span>
            </>
          )
        ) : value ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <PersonInitials name={value.displayName} />
            <span className="truncate">{value.displayName}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {value === null ? "Unassigned" : "Keep assignee"}
          </span>
        )}
        {chip ? null : (
          <RiArrowDownSLine
            aria-hidden="true"
            className="pointer-events-none size-4 shrink-0 text-muted-foreground"
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "min-w-64 gap-0 rounded-lg p-0",
          !chip && "w-(--anchor-width)",
        )}
      >
        <Command
          className="rounded-none bg-transparent p-0"
          shouldFilter={false}
        >
          <CommandInput
            autoFocus
            aria-label="Search people"
            placeholder="Search people…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[min(18rem,45vh)] p-1">
            <CommandGroup className="p-0">
              {typed ? null : (
                <CommandItem
                  value={UNASSIGNED}
                  data-checked={value === null ? "true" : undefined}
                  onSelect={() => pick(null)}
                >
                  <span className="text-muted-foreground">Unassigned</span>
                </CommandItem>
              )}
              {people.map((person) => (
                <CommandItem
                  key={person.id}
                  value={`person:${person.id}`}
                  data-checked={value?.id === person.id ? "true" : undefined}
                  onSelect={() => pick(person)}
                >
                  <PersonInitials name={person.displayName} />
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 shrink truncate">
                      {person.displayName}
                    </span>
                    {person.email ? (
                      <span className="min-w-0 shrink-[100] truncate text-xs text-muted-foreground">
                        {person.email}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <p
            role="status"
            className="h-8 shrink-0 truncate border-t px-3 py-1.5 text-xs text-muted-foreground"
          >
            {results.searching
              ? "Searching…"
              : people.length === 0 && typed
                ? "No one found"
                : `Showing ${people.length} ${people.length === 1 ? "person" : "people"}`}
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PersonInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-medium text-muted-foreground"
    >
      {personInitials(name || "?")}
    </span>
  );
}
