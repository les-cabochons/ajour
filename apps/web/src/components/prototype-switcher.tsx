// PROTOTYPE, throwaway: the floating bar that flips between prototype variants.
// It never ships: it renders nothing outside development builds.
import { useEffect } from "react";
import {
  RiArrowLeftSLine as ArrowLeft,
  RiArrowRightSLine as ArrowRight,
} from "@remixicon/react";

export type PrototypeOption = { key: string; name: string };

export function readPrototypeParam(name: string, fallback: string) {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function writePrototypeParam(name: string, value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.history.replaceState(window.history.state, "", url);
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.closest("input, textarea, [contenteditable]") !== null ||
      target.isContentEditable)
  );
}

export function PrototypeSwitcher({
  variants,
  variant,
  onVariant,
  scenes,
  scene,
  onScene,
}: {
  variants: PrototypeOption[];
  variant: string;
  onVariant: (key: string) => void;
  scenes: PrototypeOption[];
  scene: string;
  onScene: (key: string) => void;
}) {
  const index = Math.max(
    0,
    variants.findIndex((option) => option.key === variant),
  );
  const step = (delta: number) =>
    onVariant(
      variants[(index + delta + variants.length) % variants.length]!.key,
    );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const current = variants[index]!;

  return (
    <div className="fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full bg-neutral-950 px-3 py-2 text-sm text-white shadow-2xl ring-2 ring-fuchsia-500">
      <span className="text-xs font-semibold tracking-wide text-fuchsia-300 uppercase">
        Prototype
      </span>
      <button
        type="button"
        aria-label="Previous variant"
        className="rounded-full p-1 hover:bg-white/15"
        onClick={() => step(-1)}
      >
        <ArrowLeft className="size-4" />
      </button>
      <span className="min-w-44 text-center font-medium">
        {current.key} ({current.name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        className="rounded-full p-1 hover:bg-white/15"
        onClick={() => step(1)}
      >
        <ArrowRight className="size-4" />
      </button>
      <select
        aria-label="Scene"
        className="rounded-full bg-white/10 px-2 py-1 text-xs"
        value={scene}
        onChange={(event) => onScene(event.target.value)}
      >
        {scenes.map((option) => (
          <option key={option.key} value={option.key} className="text-black">
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
