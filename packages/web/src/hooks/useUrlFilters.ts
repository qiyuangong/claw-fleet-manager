import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type FilterDefinition<T> = {
  key: string;
  defaultValue: T;
  parse?: (value: string | null) => T;
  serialize?: (value: T) => string | undefined;
  debounceMs?: number;
};

type FilterDefinitions<T extends Record<string, unknown>> = {
  [K in keyof T]: FilterDefinition<T[K]>;
};

type FilterValues<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K];
};

function readFilters<T extends Record<string, unknown>>(definitions: FilterDefinitions<T>): FilterValues<T> {
  const url = new URL(window.location.href);
  const values = {} as FilterValues<T>;

  for (const [name, definition] of Object.entries(definitions) as Array<[keyof T, FilterDefinition<T[keyof T]>]>) {
    const raw = url.searchParams.get(definition.key);
    values[name] = definition.parse ? definition.parse(raw) : ((raw ?? definition.defaultValue) as T[keyof T]);
  }

  return values;
}

function valuesEqual<T>(left: T, right: T): boolean {
  return Object.is(left, right);
}

export function useUrlFilters<T extends Record<string, unknown>>(definitions: FilterDefinitions<T>) {
  const definitionsRef = useRef(definitions);
  const [values, setValues] = useState<FilterValues<T>>(() => readFilters(definitions));
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    definitionsRef.current = definitions;
  }, [definitions]);

  const writeUrl = useCallback((nextValues: FilterValues<T>) => {
    const url = new URL(window.location.href);
    const nextParams = new URLSearchParams(url.search);

    for (const [name, definition] of Object.entries(definitionsRef.current) as Array<[keyof T, FilterDefinition<T[keyof T]>]>) {
      const value = nextValues[name];
      const serialized = definition.serialize ? definition.serialize(value) : (
        value == null ? undefined : String(value)
      );
      if (serialized == null || valuesEqual(value, definition.defaultValue)) {
        nextParams.delete(definition.key);
        continue;
      }
      nextParams.set(definition.key, serialized);
    }

    const nextSearch = nextParams.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    const currentUrl = `${url.pathname}${url.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, '', nextUrl);
    }
  }, []);

  useEffect(() => {
    const handlePopstate = () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setValues(readFilters(definitionsRef.current));
    };

    window.addEventListener('popstate', handlePopstate);
    return () => {
      window.removeEventListener('popstate', handlePopstate);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const setFilter = useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((current) => {
      const nextValues = {
        ...current,
        [name]: value,
      };
      const definition = definitionsRef.current[name];

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (definition.debounceMs && definition.debounceMs > 0) {
        timeoutRef.current = window.setTimeout(() => {
          writeUrl(nextValues);
          timeoutRef.current = null;
        }, definition.debounceMs);
      } else {
        writeUrl(nextValues);
      }

      return nextValues;
    });
  }, [writeUrl]);

  const setFilters = useCallback((updates: Partial<FilterValues<T>>) => {
    setValues((current) => {
      const nextValues = {
        ...current,
        ...updates,
      };
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      writeUrl(nextValues);
      return nextValues;
    });
  }, [writeUrl]);

  return useMemo(() => ({
    values,
    setFilter,
    setFilters,
  }), [setFilter, setFilters, values]);
}
