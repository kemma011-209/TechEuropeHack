import { useCallback, useLayoutEffect, type RefObject } from "react";

/**
 * Grows a textarea to fit its content by syncing height to `scrollHeight`.
 * The maximum height (and resulting internal scroll) is enforced in CSS via a
 * `max-h-[Nlh]` class on the element, so the cap stays correct regardless of
 * the element's font size or line height.
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
) {
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref]);

  // Size on mount and whenever a pre-filled value (e.g. pill edit) changes.
  useLayoutEffect(() => {
    resize();
  }, [resize]);

  return { onInput: resize, resize };
}
