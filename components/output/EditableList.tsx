"use client";
import { useId, useState } from "react";
import { Reorder } from "framer-motion";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { SectionEditor } from "@/components/output/SectionEditor";
import { cn } from "@/lib/utils";

/**
 * A list of short strings the owner can add to, edit, delete and reorder
 * (UX-02). Used for assumptions, open items, deliverables, tech stack,
 * endpoints, dependencies and build order — everywhere the document holds a
 * `string[]` the reader might want to correct.
 *
 * Every row carries a stable key of its own, not its index, so dragging one
 * cannot make React reuse another row's state (BUG-09).
 */

interface Entry {
  key: string;
  text: string;
}

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `row-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface EditableListProps {
  items: readonly string[];
  onChange(next: string[]): void;
  readOnly?: boolean;
  /** Shown on the add button, e.g. "Add assumption". */
  addLabel: string;
  /** What one row is, for screen readers: "assumption". */
  itemNoun: string;
  maxLength?: number;
  /** Cap the list, matching the Zod schema's own limit. */
  maxItems?: number;
  multiline?: boolean;
  /** Drag to reorder. Off for lists where order carries no meaning. */
  reorderable?: boolean;
  className?: string;
  rowClassName?: string;
  empty?: string;
}

export function EditableList({
  items,
  onChange,
  readOnly = false,
  addLabel,
  itemNoun,
  maxLength = 400,
  maxItems = 40,
  multiline = false,
  reorderable = false,
  className,
  rowClassName,
  empty = "Nothing here yet.",
}: EditableListProps): React.ReactElement {
  const listId = useId();
  // Keys live beside the values: the text itself is not unique enough to be
  // a key, and the index is exactly what BUG-09 was about.
  const [keys, setKeys] = useState<string[]>(() => items.map(() => nextKey()));
  const entries: Entry[] = items.map((text, i) => ({
    key: keys[i] ?? `${listId}-${i}`,
    text,
  }));

  function commit(next: Entry[]): void {
    setKeys(next.map((entry) => entry.key));
    onChange(next.map((entry) => entry.text));
  }

  function edit(index: number, text: string): void {
    commit(entries.map((entry, i) => (i === index ? { ...entry, text } : entry)));
  }

  function remove(index: number): void {
    commit(entries.filter((_, i) => i !== index));
  }

  function add(): void {
    commit([...entries, { key: nextKey(), text: `New ${itemNoun}` }]);
  }

  if (readOnly) {
    if (items.length === 0) {
      return <p className="text-blueprint-muted text-sm">{empty}</p>;
    }
    return (
      <ul className={cn("flex flex-col gap-2", className)}>
        {entries.map((entry) => (
          <li key={entry.key} className={cn("text-blueprint-text text-sm", rowClassName)}>
            {entry.text}
          </li>
        ))}
      </ul>
    );
  }

  const rows = entries.map((entry, index) => (
    <Row
      key={entry.key}
      entry={entry}
      index={index}
      itemNoun={itemNoun}
      maxLength={maxLength}
      multiline={multiline}
      reorderable={reorderable}
      rowClassName={rowClassName}
      onEdit={edit}
      onRemove={remove}
    />
  ));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {reorderable ? (
        <Reorder.Group
          axis="y"
          values={entries}
          onReorder={commit}
          className="flex flex-col gap-2"
        >
          {rows}
        </Reorder.Group>
      ) : (
        <ul className="flex flex-col gap-2">{rows}</ul>
      )}

      {entries.length < maxItems && (
        <button
          type="button"
          onClick={add}
          className="text-blueprint-muted border-blueprint-line/30 hover:text-blueprint-text inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs"
        >
          <Plus size={12} />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function Row({
  entry,
  index,
  itemNoun,
  maxLength,
  multiline,
  reorderable,
  rowClassName,
  onEdit,
  onRemove,
}: {
  entry: Entry;
  index: number;
  itemNoun: string;
  maxLength: number;
  multiline: boolean;
  reorderable: boolean;
  rowClassName?: string;
  onEdit(index: number, text: string): void;
  onRemove(index: number): void;
}): React.ReactElement {
  const body = (
    <div
      className={cn(
        "border-blueprint-line/15 flex items-start gap-2 rounded-lg border bg-white/[0.02] px-3 py-2",
        rowClassName,
      )}
    >
      {reorderable && (
        <GripVertical
          size={14}
          className="text-blueprint-muted mt-1 shrink-0 cursor-grab"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <SectionEditor
          value={entry.text}
          multiline={multiline}
          maxLength={maxLength}
          ariaLabel={itemNoun}
          onConfirm={(next) => onEdit(index, next)}
          className="text-blueprint-text text-sm"
        />
      </div>
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Delete ${itemNoun}`}
        className="text-blueprint-muted mt-0.5 shrink-0 rounded-md p-1 hover:text-red-300"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );

  return reorderable ? (
    <Reorder.Item value={entry} as="li">
      {body}
    </Reorder.Item>
  ) : (
    <li>{body}</li>
  );
}
