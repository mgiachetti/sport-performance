import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State that belongs to one `key`: when the key changes, the value is
 * `initial` again. For the screens of a tab, which stay mounted and only get
 * new params (the alert opened, the session of a push): what was typed or
 * picked for one never shows on the next. The setter is bound to the key it
 * was handed with, so an answer that arrives after the key changed (a review
 * of the previous alert) never lands on the new one.
 */
export function useKeyedState<T>(key: string, initial: T): readonly [T, (value: T) => void] {
  const [state, setState] = useState<{ readonly key: string; readonly value: T }>({
    key,
    value: initial,
  });
  // The key on screen: a setter of another key is a late answer and is dropped.
  const shown = useRef(key);
  useEffect(() => {
    shown.current = key;
  }, [key]);
  const value = state.key === key ? state.value : initial;
  const set = useCallback(
    (next: T) => {
      if (shown.current !== key) return;
      setState({ key, value: next });
    },
    [key],
  );
  return [value, set];
}
