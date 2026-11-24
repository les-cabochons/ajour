import { act } from "@testing-library/react";

/*
 * The geometry `@tanstack/react-virtual` reads, which jsdom leaves at zero:
 * a scroller's client size, each row's offset size, and a scroll offset the
 * test moves. With it the real virtualizer mounts only the rows near the
 * screen, as it does in a browser.
 */

type Dimension =
  "clientWidth" | "clientHeight" | "offsetWidth" | "offsetHeight";

const DIMENSIONS: Dimension[] = [
  "clientWidth",
  "clientHeight",
  "offsetWidth",
  "offsetHeight",
];

/**
 * Gives the elements matching each selector its width and height, as both
 * their client and offset sizes; the first match wins. Returns a function
 * that gives jsdom its zeros back.
 */
export function sizeElements(
  sizes: { selector: string; width?: number; height?: number }[],
): () => void {
  const originals = DIMENSIONS.map(
    (name) =>
      [
        name,
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
      ] as const,
  );
  for (const name of DIMENSIONS) {
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      name,
    );
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        const size = sizes.find(({ selector }) => this.matches(selector));
        const value = name.endsWith("Width") ? size?.width : size?.height;
        return value ?? original?.get?.call(this) ?? 0;
      },
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor)
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  };
}

/** Lets `element` scroll: its offset holds what is set, and `scrollTo` moves it. */
export function makeScrollable(element: HTMLElement) {
  let top = 0;
  let left = 0;
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    },
    scrollLeft: {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    },
  });
  element.scrollTo = ((options?: ScrollToOptions | number, y?: number) => {
    if (typeof options === "number") {
      left = options;
      top = y ?? top;
    } else {
      top = options?.top ?? top;
      left = options?.left ?? left;
    }
    element.dispatchEvent(new Event("scroll"));
  }) as typeof element.scrollTo;
}

/** Scrolls `element`, made scrollable, to `top` (or `left`) as the user would. */
export function scrollElement(
  element: HTMLElement,
  offset: { top?: number; left?: number },
) {
  act(() => {
    if (offset.top !== undefined) element.scrollTop = offset.top;
    if (offset.left !== undefined) element.scrollLeft = offset.left;
    element.dispatchEvent(new Event("scroll"));
  });
}
