import { useRef } from "react";
import {
  RiCloseLine as CloseIcon,
  RiSearchLine as SearchIcon,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { SearchBoxState } from "@/lib/search-box-state";
import { cn } from "@/lib/utils";

/**
 * A Search button that expands in place into a search box, as in the sidebar
 * and the Backlog page's top bar. Escape clears and closes it. Leaving it
 * empty closes it too; a typed query stays so the user can open the rows it
 * found. The state is the host's, see `lib/search-box-state.ts`.
 */
export function ExpandingSearch({
  state: { open, query },
  onChange,
  label,
  className,
  buttonClassName,
}: {
  state: SearchBoxState;
  onChange: (patch: Partial<SearchBoxState>) => void;
  /**
   * Names the open box for assistive technology: "Search the backlog". The
   * button is "Search", told apart by its landmark, the sidebar or the page.
   */
  label: string;
  /** The open box's size, such as its width in a toolbar. */
  className?: string;
  buttonClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape gives focus back to the button when it mounts again; a click
  // elsewhere leaves focus where the user put it.
  const refocusRef = useRef(false);

  function close() {
    onChange({ open: false, query: "" });
  }

  if (!open) {
    return (
      <TooltipButton
        label="Search"
        side="bottom"
        render={
          <Button
            ref={(button) => {
              if (button && refocusRef.current) {
                refocusRef.current = false;
                button.focus();
              }
            }}
            variant="ghost"
            size="icon"
            className={buttonClassName}
            onClick={() => onChange({ open: true })}
          />
        }
      >
        <SearchIcon />
      </TooltipButton>
    );
  }

  return (
    <InputGroup className={cn("h-8 min-w-0", className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        autoFocus
        type="search"
        aria-label={label}
        placeholder="Search"
        value={query}
        onChange={(event) => onChange({ query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            refocusRef.current = true;
            close();
          }
        }}
        onBlur={() => {
          if (!query.trim()) close();
        }}
        className="[&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <InputGroupAddon align="inline-end">
          <TooltipButton
            label="Clear search"
            render={
              <InputGroupButton
                size="icon-xs"
                // The button unmounts with the query, so focus goes back to
                // the box, whether it was clicked or pressed from the keyboard.
                onClick={() => {
                  onChange({ query: "" });
                  inputRef.current?.focus();
                }}
              />
            }
          >
            <CloseIcon />
          </TooltipButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
