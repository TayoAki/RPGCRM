"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface BoardColumn<K extends string> {
  key: K;
  label: string;
  style: string;
  hint?: string;
}

/** Generic kanban with HTML5 drag-and-drop. `canMove` gates drops per item/column. */
export function Board<T, K extends string>({ columns, items, columnOf, itemKey, renderCard, onMove, canMove, summary }: {
  columns: BoardColumn<K>[];
  items: T[];
  columnOf: (item: T) => K | null;
  itemKey: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onMove?: (itemId: string, to: K) => void;
  canMove?: (item: T, to: K) => boolean;
  summary?: (items: T[]) => string;
}) {
  const [over, setOver] = useState<K | null>(null);
  const byId = new Map(items.map((i) => [itemKey(i), i]));
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((col) => {
        const colItems = items.filter((i) => columnOf(i) === col.key);
        return (
          <section
            key={col.key}
            className={cn("w-64 shrink-0 rounded-lg p-1 transition", over === col.key && onMove && "bg-accent/50 ring-1 ring-ring")}
            onDragOver={(e) => {
              if (!onMove) return;
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              if (!onMove) return;
              const id = e.dataTransfer.getData("text/plain");
              const item = byId.get(id);
              if (!item) return;
              if (canMove && !canMove(item, col.key)) return;
              onMove(id, col.key);
            }}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", col.style)} title={col.hint}>{col.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{colItems.length}{summary ? ` · ${summary(colItems)}` : ""}</span>
            </div>
            <div className="flex flex-col gap-2">
              {colItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">None</div>
              ) : (
                colItems.map((it) => (
                  <div
                    key={itemKey(it)}
                    draggable={!!onMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", itemKey(it));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={cn(onMove && "cursor-grab active:cursor-grabbing")}
                  >
                    {renderCard(it)}
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
