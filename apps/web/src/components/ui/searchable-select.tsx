import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  group?: string;
  keywords?: string[];
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  onChange: (nextValue: string) => void;
  placeholder: string;
  emptyMessage: string;
  disabled?: boolean;
  clearLabel?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
}

type PopoverSide = "top" | "bottom";

interface PopoverLayout {
  side: PopoverSide;
  style: CSSProperties;
}

const POPOVER_GAP_PX = 6;
const POPOVER_MARGIN_PX = 8;
const POPOVER_MAX_HEIGHT_PX = 224;

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesOption(option: SearchableSelectOption, query: string) {
  if (!query) {
    return true;
  }

  const haystacks = [option.label, ...(option.keywords ?? [])];
  return haystacks.some((candidate) =>
    normalizeSearchText(candidate).includes(query),
  );
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  emptyMessage,
  disabled = false,
  clearLabel,
  ariaLabel,
  className,
  inputClassName,
}: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLElement | null>>([]);
  const listboxId = useId();
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const selectedLabel = selectedOption?.label ?? "";
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [popoverLayout, setPopoverLayout] = useState<PopoverLayout | null>(
    null,
  );

  const normalizedQuery = isTyping ? normalizeSearchText(query) : "";
  const filteredOptions = useMemo(
    () => options.filter((option) => matchesOption(option, normalizedQuery)),
    [normalizedQuery, options],
  );
  const visibleOptions = useMemo(
    () =>
      clearLabel && !normalizedQuery
        ? [{ value: "", label: clearLabel }, ...filteredOptions]
        : filteredOptions,
    [clearLabel, filteredOptions, normalizedQuery],
  );
  const groupedVisibleOptions = useMemo(() => {
    const groups: Array<{
      key: string;
      label?: string;
      options: Array<{ option: SearchableSelectOption; index: number }>;
    }> = [];
    const groupIndexByKey = new Map<string, number>();

    visibleOptions.forEach((option, index) => {
      const key = option.group ?? "__ungrouped__";
      const existingIndex = groupIndexByKey.get(key);
      const entry = { option, index };

      if (existingIndex === undefined) {
        groupIndexByKey.set(key, groups.length);
        groups.push({
          key,
          label: option.group,
          options: [entry],
        });
        return;
      }

      groups[existingIndex]!.options.push(entry);
    });

    return groups;
  }, [visibleOptions]);
  const inputValue = isOpen
    ? isTyping
      ? query
      : selectedLabel
    : selectedLabel;

  useEffect(() => {
    if (!disabled) {
      return;
    }

    setIsOpen(false);
    setIsTyping(false);
    setQuery("");
    setHighlightedIndex(-1);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) {
      return;
    }

    optionRefs.current[highlightedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [highlightedIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (
        containerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }

      closeMenu();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () =>
      document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverLayout(null);
      return;
    }

    function updatePopoverLayout() {
      const inputElement = inputRef.current;
      const popoverElement = popoverRef.current;
      if (!inputElement || !popoverElement) {
        return;
      }

      const rect = inputElement.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
      const viewportOffsetTop = viewport?.offsetTop ?? 0;

      const width = Math.min(
        rect.width,
        Math.max(0, viewportWidth - POPOVER_MARGIN_PX * 2),
      );
      const left = Math.min(
        Math.max(rect.left, viewportOffsetLeft + POPOVER_MARGIN_PX),
        viewportOffsetLeft + viewportWidth - width - POPOVER_MARGIN_PX,
      );

      const contentHeight = Math.min(
        popoverElement.scrollHeight,
        POPOVER_MAX_HEIGHT_PX,
      );
      const spaceAbove = Math.max(
        0,
        rect.top - viewportOffsetTop - POPOVER_MARGIN_PX,
      );
      const spaceBelow = Math.max(
        0,
        viewportOffsetTop + viewportHeight - rect.bottom - POPOVER_MARGIN_PX,
      );
      const side: PopoverSide =
        spaceBelow >= contentHeight || spaceBelow >= spaceAbove
          ? "bottom"
          : "top";
      const availableHeight = side === "bottom" ? spaceBelow : spaceAbove;
      const maxHeight = Math.min(POPOVER_MAX_HEIGHT_PX, availableHeight);
      const renderedHeight = Math.min(popoverElement.scrollHeight, maxHeight);
      const top =
        side === "bottom"
          ? Math.min(
              rect.bottom + POPOVER_GAP_PX,
              viewportOffsetTop +
                viewportHeight -
                renderedHeight -
                POPOVER_MARGIN_PX,
            )
          : Math.max(
              viewportOffsetTop + POPOVER_MARGIN_PX,
              rect.top - POPOVER_GAP_PX - renderedHeight,
            );

      setPopoverLayout({
        side,
        style: {
          top,
          left,
          width,
          maxHeight,
        },
      });
    }

    updatePopoverLayout();

    const viewport = window.visualViewport;
    window.addEventListener("resize", updatePopoverLayout);
    window.addEventListener("scroll", updatePopoverLayout, true);
    viewport?.addEventListener("resize", updatePopoverLayout);
    viewport?.addEventListener("scroll", updatePopoverLayout);

    return () => {
      window.removeEventListener("resize", updatePopoverLayout);
      window.removeEventListener("scroll", updatePopoverLayout, true);
      viewport?.removeEventListener("resize", updatePopoverLayout);
      viewport?.removeEventListener("scroll", updatePopoverLayout);
    };
  }, [inputValue, isOpen, visibleOptions.length]);

  function closeMenu() {
    setIsOpen(false);
    setIsTyping(false);
    setQuery("");
    setHighlightedIndex(-1);
    setPopoverLayout(null);
  }

  function commitSelection(nextValue: string) {
    onChange(nextValue);
    setIsOpen(false);
    setIsTyping(false);
    setQuery("");
    setHighlightedIndex(-1);
    setPopoverLayout(null);
  }

  function openMenu() {
    if (disabled) {
      return;
    }

    setIsOpen(true);
    setIsTyping(false);
    setQuery(selectedLabel);
    setHighlightedIndex(
      value ? visibleOptions.findIndex((option) => option.value === value) : -1,
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        if (visibleOptions.length === 0) {
          return -1;
        }

        return current < 0
          ? 0
          : Math.min(current + 1, visibleOptions.length - 1);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        if (visibleOptions.length === 0) {
          return -1;
        }

        return current <= 0 ? 0 : current - 1;
      });
      return;
    }

    if (event.key === "Escape") {
      if (!isOpen) {
        return;
      }

      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === "Enter") {
      const highlightedOption =
        highlightedIndex >= 0 ? visibleOptions[highlightedIndex] : null;
      const singleFilteredOption =
        filteredOptions.length === 1 ? filteredOptions[0] : null;
      const nextOption = highlightedOption ?? singleFilteredOption;

      if (!nextOption) {
        return;
      }

      event.preventDefault();
      commitSelection(nextOption.value);
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn("searchable-select", className)}
      data-open={isOpen ? "true" : "false"}
    >
      <InputGroup
        className={cn(
          "searchable-select-input-group",
          disabled && "opacity-50",
        )}
        data-disabled={disabled ? "true" : undefined}
      >
        <InputGroupInput
          ref={inputRef}
          type="text"
          role="combobox"
          className={cn("searchable-select-input", inputClassName)}
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlightedIndex >= 0
              ? `${listboxId}-option-${highlightedIndex}`
              : undefined
          }
          onFocus={(event) => {
            openMenu();
            event.currentTarget.select();
          }}
          onClick={() => openMenu()}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (
              nextTarget instanceof Node &&
              (containerRef.current?.contains(nextTarget) ||
                popoverRef.current?.contains(nextTarget))
            ) {
              return;
            }

            closeMenu();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setIsTyping(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        <InputGroupAddon align="inline-end" aria-hidden="true">
          <ChevronDown className="searchable-select-icon" />
        </InputGroupAddon>
      </InputGroup>

      {isOpen
        ? createPortal(
            <Command
              ref={popoverRef}
              className="searchable-select-popover"
              data-side={popoverLayout?.side ?? "bottom"}
              shouldFilter={false}
              role="listbox"
              id={listboxId}
              style={{
                ...popoverLayout?.style,
                visibility: popoverLayout ? "visible" : "hidden",
              }}
            >
              {visibleOptions.length > 0 ? (
                <CommandList>
                  {groupedVisibleOptions.map((group) => (
                    <CommandGroup key={group.key} heading={group.label}>
                      {group.options.map(({ option, index }) => (
                        <CommandItem
                          key={`${option.value || "empty"}-${option.label}`}
                          ref={(element) => {
                            optionRefs.current[index] = element;
                          }}
                          id={`${listboxId}-option-${index}`}
                          role="option"
                          tabIndex={-1}
                          value={`${option.value || "empty"}-${option.label}`}
                          data-checked={
                            option.value === value ? "true" : undefined
                          }
                          aria-selected={option.value === value}
                          className={cn(
                            "searchable-select-option",
                            highlightedIndex === index && "is-active",
                            option.value === "" && "is-clear",
                          )}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            commitSelection(option.value);
                          }}
                          onSelect={() => commitSelection(option.value)}
                        >
                          <span>{option.label}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              ) : (
                <CommandEmpty className="searchable-select-empty">
                  {emptyMessage}
                </CommandEmpty>
              )}
            </Command>,
            document.body,
          )
        : null}
    </div>
  );
}
