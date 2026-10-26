import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface ChoiceMenuOption {
  label: string;
  value: string;
}

export interface ChoiceMenuProps {
  disabled?: boolean;
  id: string;
  kind?: "device" | "compact";
  onChange: (value: string) => void;
  options: ChoiceMenuOption[];
  placeholder: string;
  searchable?: boolean;
  value: string;
}

function MicrophoneIcon() {
  return <svg aria-hidden="true" className="choice-menu-icon" viewBox="0 0 24 24">
    <rect x="8.25" y="2.75" width="7.5" height="12" rx="3.75" />
    <path d="M5.75 11.5v.75a6.25 6.25 0 0 0 12.5 0v-.75M12 18.5v2.75M8.75 21.25h6.5" />
  </svg>;
}

function SearchIcon() {
  return <svg aria-hidden="true" className="choice-menu-search-icon" viewBox="0 0 24 24">
    <circle cx="10.75" cy="10.75" r="6.25" />
    <path d="m15.5 15.5 4 4" />
  </svg>;
}

export function ChoiceMenu({
  disabled = false,
  id,
  kind = "compact",
  onChange,
  options,
  placeholder,
  searchable = false,
  value,
}: ChoiceMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? placeholder;
  const panelId = `${id}-options`;
  const visibleOptions = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? options.filter((option) => option.label.toLocaleLowerCase().includes(term)) : options;
  }, [options, query]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    if (searchable) window.requestAnimationFrame(() => search.current?.focus());
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, searchable]);

  function focusOption(index: number) {
    if (!visibleOptions.length) return;
    const nextIndex = (index + visibleOptions.length) % visibleOptions.length;
    optionButtons.current[nextIndex]?.focus();
  }

  function closeAndFocus() {
    setOpen(false);
    trigger.current?.focus();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!searchable) {
        const selectedIndex = visibleOptions.findIndex((option) => option.value === value);
        const start = selectedIndex >= 0 ? selectedIndex : event.key === "ArrowDown" ? 0 : visibleOptions.length - 1;
        window.requestAnimationFrame(() => focusOption(start));
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeAndFocus();
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : visibleOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocus();
    }
  }

  function choose(option: ChoiceMenuOption) {
    onChange(option.value);
    closeAndFocus();
  }

  return <div className={`choice-menu choice-menu-${kind}${open ? " is-open" : ""}`} ref={root}>
    <button
      aria-controls={open ? panelId : undefined}
      aria-expanded={open}
      className="choice-menu-trigger"
      disabled={disabled}
      id={id}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleTriggerKeyDown}
      ref={trigger}
      type="button"
    >
      {kind === "device" && <MicrophoneIcon />}
      <span className="choice-menu-trigger-label" title={selectedLabel}>{selectedLabel}</span>
      <span aria-hidden="true" className="choice-menu-chevron">⌄</span>
    </button>

    {open && <div aria-label={`${selectedLabel} choices`} className={`choice-menu-panel${searchable ? " is-searchable" : ""}`} id={panelId}>
      {searchable && <div className="choice-menu-search">
        <SearchIcon />
        <input
          aria-label="Search input devices"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeAndFocus();
            if (event.key === "ArrowDown" && visibleOptions.length) {
              event.preventDefault();
              focusOption(0);
            }
          }}
          placeholder="Search input devices…"
          ref={search}
          type="search"
          value={query}
        />
      </div>}
      <div className="choice-menu-options">
        {visibleOptions.length ? visibleOptions.map((option, index) => <button
          aria-pressed={option.value === value}
          className={option.value === value ? "choice-menu-option is-selected" : "choice-menu-option"}
          key={option.value}
          onClick={() => choose(option)}
          onKeyDown={(event) => handleOptionKeyDown(event, index)}
          ref={(element) => { optionButtons.current[index] = element; }}
          title={option.label}
          type="button"
        >
          {kind === "device" && <MicrophoneIcon />}
          <span>{option.label}</span>
          {option.value === value && <span aria-hidden="true" className="choice-menu-check">✓</span>}
        </button>) : <p className="choice-menu-empty">No matching input devices</p>}
      </div>
    </div>}
  </div>;
}
