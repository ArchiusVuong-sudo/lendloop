"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent } from "react";
import { AvailabilityBadge } from "@/components/badges";
import { Badge, Button, Card, EmptyState, ErrorText, Field, inputClass, Loading, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import {
  CATEGORIES,
  categoryLabel,
  CONDITIONS,
  conditionLabel,
  LIMITS,
  type Category,
  type Condition,
} from "@/convex/lib/constants";
import { errorMessage } from "@/lib/errors";

type Listing = FunctionReturnType<typeof api.tools.mine>[number];
type ListingInput = { name: string; category: Category; condition: Condition; description: string };

const EMPTY: ListingInput = { name: "", category: "power_tools", condition: "good", description: "" };

export default function MyListingsPage() {
  const listings = useQuery(api.tools.mine);
  const createTool = useMutation(api.tools.create);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="My listings"
        subtitle="Tools you lend to the neighborhood."
        action={!adding && <Button onClick={() => setAdding(true)}>List a tool</Button>}
      />
      {adding && (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold">List a tool</h2>
          <ListingForm
            initial={EMPTY}
            submitLabel="Publish listing"
            onSubmit={async (input) => {
              await createTool(input);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}
      {listings === undefined ? (
        <Loading />
      ) : listings.length === 0 ? (
        <EmptyState>You have not listed anything yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {listings.map((listing) => (
            <li key={listing._id} data-testid="listing-card">
              <ListingRow listing={listing} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ListingRow({ listing }: { listing: Listing }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateTool = useMutation(api.tools.update);
  const removeTool = useMutation(api.tools.remove);

  async function remove() {
    if (!confirm(`Delete "${listing.name}"? Its past requests are deleted too.`)) return;
    try {
      await removeTool({ toolId: listing._id });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (editing) {
    return (
      <Card>
        <ListingForm
          initial={listing}
          submitLabel="Save changes"
          onSubmit={async (input) => {
            await updateTool({ toolId: listing._id, ...input });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{listing.name}</h2>
          <p className="text-sm text-stone-600">
            {categoryLabel(listing.category)} &middot; {conditionLabel(listing.condition)}
          </p>
          {listing.description && <p className="mt-1 text-sm text-stone-700">{listing.description}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <AvailabilityBadge availability={listing.availability} />
          {listing.pendingRequests > 0 && (
            <Badge tone="amber">
              {listing.pendingRequests} pending request{listing.pendingRequests > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="danger" onClick={remove}>
          Delete
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function ListingForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ListingInput;
  submitLabel: string;
  onSubmit: (input: ListingInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ListingInput>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <input
          className={inputClass}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          minLength={LIMITS.toolName.min}
          maxLength={LIMITS.toolName.max}
          placeholder="Cordless drill"
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          <select
            className={inputClass}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select
            className={inputClass}
            value={form.condition}
            onChange={(e) => setForm({ ...form, condition: e.target.value as Condition })}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Short description">
        <textarea
          className={inputClass}
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          maxLength={LIMITS.description.max}
          placeholder="What is included, anything to know before borrowing"
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
