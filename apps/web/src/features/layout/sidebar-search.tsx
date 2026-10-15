import { useEffect, useRef, useState } from "react";
import {
  RiCloseLine as CloseIcon,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

/**
 * The sidebar's Search: a button that expands into a search box over the view
 * switcher's row. Escape clears and closes it. Leaving it empty closes it too;
 * a typed query stays so the user can open the rows it found.
 */
export function SidebarSearch({
  open,
  query,
  onOpenChange,
  onQueryChange,
}: {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Escape gives focus back to the button; a click elsewhere keeps it there.
  const [refocus, setRefocus] = useState(false);

  useEffect(() => {
    if (!open && refocus) {
      buttonRef.current?.focus();
      setRefocus(false);
    }
  }, [open, refocus]);

  function close() {
    onQueryChange("");
    onOpenChange(false);
  }

  if (!open) {
    return (
      <TooltipButton
        label="Search"
        side="bottom"
        render={
          <Button
            ref={buttonRef}
            variant="ghost"
            size="icon"
            className="ajour-app-sidebar-toggle"
            onClick={() => onOpenChange(true)}
          />
        }
      >
        <SearchIcon />
      </TooltipButton>
    );
  }

  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-foreground/5 pr-0.5 pl-2 focus-within:ring-1 focus-within:ring-ring">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        type="search"
        aria-label="Search the sidebar"
        placeholder="Search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setRefocus(true);
            close();
          }
        }}
        onBlur={() => {
          if (!query.trim()) close();
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <TooltipButton
          label="Clear search"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          // Keeps focus in the box, so its blur does not close it first.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onQueryChange("")}
        >
          <CloseIcon className="size-3.5" />
        </TooltipButton>
      ) : null}
    </div>
  );
}

/**
 * The project filter beside Search, like T3 Code's: a menu with its own
 * search, "All projects", then the active projects. The pick is saved per
 * device in the sidebar layout.
 */
export function SidebarProjectFilter({
  projects,
  projectId,
  onChange,
}: {
  projects: readonly LocalProject[];
  projectId?: string;
  onChange: (projectId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = projects.filter((project) => project.status === "active");
  const picked = active.find((project) => project._id === projectId);
  if (active.length === 0) return null;

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
            : "Filter by project"
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
        aria-label="Filter the sidebar by project"
      >
        <Command className="rounded-none bg-transparent p-0">
          <CommandInput autoFocus placeholder="Search projects..." />
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
                data-checked={project._id === picked?._id ? "true" : undefined}
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
