"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent } from "react";
import { AvailabilityBadge, TrustedBadge } from "@/components/badges";
import { Badge, Button, Card, EmptyState, ErrorText, Field, inputClass, Loading, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, categoryLabel, conditionLabel, type Category } from "@/convex/lib/constants";
import { errorMessage } from "@/lib/errors";
import { localToday } from "@/lib/format";

export default function ToolsPage() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const me = useQuery(api.users.me);

  return (
    <>
      <PageHeader
        title="All tools"
        subtitle="Everything your neighbors lend, with what is free right now."
        action={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-stone-600">Category</span>
            <select
              className={`${inputClass} w-44`}
              value={category}
              onChange={(e) => setCategory(e.target.value as Category | "")}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState>No tools in this category yet.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool._id} data-testid="tool-card">
              <ToolCard tool={tool} isAdmin={me?.role === "admin"} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type ToolRow = FunctionReturnType<typeof api.tools.list>[number];

function ToolCard({ tool, isAdmin }: { tool: ToolRow; isAdmin: boolean }) {
  const [requesting, setRequesting] = useState(false);
  const removeTool = useMutation(api.tools.remove);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Remove "${tool.name}" from LendLoop? This also deletes its requests.`)) return;
    try {
      await removeTool({ toolId: tool._id });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{tool.name}</h2>
          <p className="text-sm text-stone-600">
            {categoryLabel(tool.category)} &middot; {conditionLabel(tool.condition)}
          </p>
        </div>
        <AvailabilityBadge availability={tool.availability} />
      </div>
      {tool.description && <p className="text-sm text-stone-700">{tool.description}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-sm text-stone-600">
        <span className="flex items-center gap-2">
          {tool.isMine ? <Badge>Your listing</Badge> : <>Lent by {tool.ownerName}</>}
          {tool.ownerTrusted && <TrustedBadge />}
        </span>
        <span className="flex gap-2">
          {isAdmin && (
            <Button variant="danger" onClick={remove}>
              Remove listing
            </Button>
          )}
          {!tool.isMine &&
            (tool.hasPendingRequest ? (
              <Badge tone="amber">Request pending</Badge>
            ) : (
              !requesting && <Button onClick={() => setRequesting(true)}>Request to borrow</Button>
            ))}
        </span>
      </div>
      <ErrorText>{error}</ErrorText>
      {requesting && <RequestForm toolId={tool._id} onDone={() => setRequesting(false)} />}
    </Card>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const today = localToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createRequest = useMutation(api.requests.create);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRequest({ toolId, startDate, endDate });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-stone-50 p-3" aria-label="Borrow request">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" className={inputClass} value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <Field label="Until">
          <input type="date" className={inputClass} value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Send request
        </Button>
      </div>
    </form>
  );
}
