import { useRef, useState, type ReactNode } from "react";
import {
  RiCloseLine as CloseIcon,
  RiDraggable as CustomOrderIcon,
  RiFilter3Line as FilterIcon,
  RiFolderLine as AllProjectsIcon,
  RiSearchLine as SearchIcon,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  getLocalProjectDisplayName,
  type BacklogSortMode,
  type LocalProject,
} from "@/domain/local-state";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import { ProjectIcon } from "@/lib/project-icons";
import { updateSidebarSearch, useSidebarSearch } from "@/lib/sidebar-search";
import { cn } from "@/lib/utils";

/**
 * The sidebar's Search: a button that expands into a search box over the view
 * switcher's row. Escape clears and closes it. Leaving it empty closes it too;
 * a typed query stays so the user can open the rows it found, even when the
 * sidebar hides in between. `lib/sidebar-search.ts` holds the state.
 */
export function SidebarSearch() {
  const { open, query } = useSidebarSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape gives focus back to the button when it mounts again; a click
  // elsewhere leaves focus where the user put it.
  const refocusRef = useRef(false);

  function close() {
    updateSidebarSearch({ open: false, query: "" });
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
            className="ajour-app-sidebar-toggle"
            onClick={() => updateSidebarSearch({ open: true })}
          />
        }
      >
        <SearchIcon />
      </TooltipButton>
    );
  }

  return (
    <InputGroup className="h-8 min-w-0 flex-1">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        autoFocus
        type="search"
        aria-label="Search the sidebar"
        placeholder="Search"
        value={query}
        onChange={(event) => updateSidebarSearch({ query: event.target.value })}
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
                  updateSidebarSearch({ query: "" });
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

/** The orderings the sidebar menu offers. Custom allows dragging rows. */
const SIDEBAR_ORDERINGS = [
  {
    value: "custom",
    label: "Custom order",
    icon: <CustomOrderIcon className="size-4" />,
  },
  {
    value: "priority_asc",
    label: "Priority order",
    icon: <PriorityIcon priority={2} decorative className="text-current" />,
  },
] as const satisfies readonly {
  value: BacklogSortMode;
  label: string;
  icon: ReactNode;
}[];

/**
 * The filter menu beside Search, like T3 Code's: a search box with the
 * ordering toggle beside it, then "All projects" and the active projects. The
 * ordering is the Backlog page's, so switching it here switches both. The
 * toggle offers Custom and Priority; when the Backlog page picked another
 * ordering, neither is pressed. Picking an ordering keeps the menu open. The
 * project pick is saved per device in the sidebar layout.
 */
export function SidebarFilterMenu({
  projects,
  projectId,
  onChange,
  ordering,
  onOrderingChange,
}: {
  projects: readonly LocalProject[];
  projectId?: string;
  onChange: (projectId: string | undefined) => void;
  ordering: BacklogSortMode;
  onOrderingChange: (ordering: BacklogSortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = projects.filter((project) => project.status === "active");
  const picked = active.find((project) => project._id === projectId);

  function pick(nextProjectId: string | undefined) {
    onChange(nextProjectId);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipButton
        label={
          picked
            ? `Filtered to ${getLocalProjectDisplayName(picked)}`
            : "Filter and order"
        }
        side="bottom"
        render={
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "ajour-app-sidebar-toggle",
                  picked && "bg-foreground/[0.07] text-foreground",
                )}
              />
            }
          />
        }
      >
        <FilterIcon />
      </TooltipButton>
      <PopoverContent
        align="end"
        className="w-64 gap-0 overflow-hidden p-0"
        aria-label="Filter and order the sidebar"
      >
        <Command
          className="rounded-none bg-transparent p-0"
          // Items search their names in `keywords`, never their ids.
          filter={(_value, search, keywords = []) =>
            keywords.join(" ").toLowerCase().includes(search.toLowerCase())
              ? 1
              : 0
          }
        >
          <div className="flex items-center justify-end gap-1 pr-1">
            {active.length > 0 ? (
              <div className="min-w-0 flex-1">
                <CommandInput autoFocus placeholder="Search projects..." />
              </div>
            ) : null}
            {/* The input sits under 4px of padding, so the toggle drops to match. */}
            <ToggleGroup
              aria-label="Ordering"
              variant="outline"
              className="mt-1"
              value={[ordering]}
              onValueChange={(next) => {
                // Pressing the pressed button would clear it; keep the ordering.
                const nextOrdering = SIDEBAR_ORDERINGS.find(
                  (option) =>
                    option.value !== ordering && next.includes(option.value),
                )?.value;
                if (nextOrdering) onOrderingChange(nextOrdering);
              }}
              // The Command around the toggle takes Enter and the arrows for
              // its list. Keep them on the toggle; Escape still closes the menu.
              onKeyDown={(event) => {
                if (event.key !== "Escape" && event.key !== "Tab")
                  event.stopPropagation();
              }}
            >
              {SIDEBAR_ORDERINGS.map((option) => (
                <TooltipButton
                  key={option.value}
                  label={option.label}
                  side="bottom"
                  render={
                    <ToggleGroupItem
                      value={option.value}
                      aria-label={option.label}
                      className="px-2 text-muted-foreground aria-pressed:text-foreground"
                    />
                  }
                >
                  {option.icon}
                </TooltipButton>
              ))}
            </ToggleGroup>
          </div>
          {active.length > 0 ? (
            <CommandList className="max-h-[min(22rem,55vh)] p-1">
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandItem
                value="all-projects"
                keywords={["All projects"]}
                data-checked={picked ? undefined : "true"}
                onSelect={() => pick(undefined)}
              >
                <AllProjectsIcon className="text-muted-foreground" />
                <span className="flex-1">All projects</span>
              </CommandItem>
              {active.map((project) => (
                <CommandItem
                  key={project._id}
                  value={project._id}
                  keywords={[
                    getLocalProjectDisplayName(project),
                    project.name,
                    project.code ?? "",
                  ]}
                  data-checked={
                    project._id === picked?._id ? "true" : undefined
                  }
                  onSelect={() => pick(project._id)}
                >
                  <ProjectIcon
                    icon={project.icon}
                    color={project.color}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {getLocalProjectDisplayName(project)}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
