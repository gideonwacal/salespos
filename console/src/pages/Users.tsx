import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type UserRow } from "../api";
import { ago, date } from "../format";
import { go, Link } from "../router";
import { Button, Empty, Input, PageTitle, Panel, Table, Tag } from "../ui";

export function Users({ query }: { query: URLSearchParams }) {
  const search = query.get("search") ?? undefined;
  const [text, setText] = useState(search ?? "");
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["users", search],
    queryFn: () => api.users({ search }),
  });

  const toggle = useMutation({
    mutationFn: (user: UserRow) => api.setUserActive(user.id, !user.is_active),
    onSuccess: (result) => {
      toast.success(result.is_active ? "Sign-in restored" : "User blocked");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update."),
  });

  return (
    <>
      <PageTitle aside={<span className="font-mono text-xs text-dim">{data.length} shown</span>}>
        Users
      </PageTitle>
      <form
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          go("/users", { search: text.trim() || undefined });
        }}
      >
        <Input
          placeholder="Search email, name or phone…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>

      <Panel flush>
        <Table head={["User", "Businesses", "Last sign-in", "Last active", "Joined", ""]}>
          {isLoading && <Empty colSpan={6}>loading…</Empty>}
          {!isLoading && data.length === 0 && <Empty colSpan={6}>No users match.</Empty>}
          {data.map((u) => (
            <tr key={u.id} className={u.is_active ? "" : "opacity-60"}>
              <td>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {u.full_name || u.email}
                  {u.is_superuser && <Tag className="border-signal/50 text-signal">Owner</Tag>}
                  {!u.is_active && <Tag className="border-bad/50 text-bad">Blocked</Tag>}
                </p>
                <p className="text-xs text-dim">
                  {u.email}
                  {u.phone && ` · ${u.phone}`}
                </p>
              </td>
              <td>
                {u.businesses.length === 0 ? (
                  <span className="text-dim">—</span>
                ) : (
                  u.businesses.map((b) => (
                    <p key={b.id}>
                      <Link to={`/businesses/${b.id}`} className="text-info hover:underline">
                        {b.name}
                      </Link>{" "}
                      <span className="text-xs capitalize text-dim">
                        {b.role}
                        {!b.active && " · removed"}
                      </span>
                    </p>
                  ))
                )}
              </td>
              <td className="whitespace-nowrap font-mono text-xs text-dim">
                {u.last_login ? ago(u.last_login) : "never"}
              </td>
              <td className="whitespace-nowrap font-mono text-xs">
                {u.last_activity ? (
                  <Link to="/activity" query={{ user: u.id }} className="text-info hover:underline">
                    {ago(u.last_activity)}
                  </Link>
                ) : (
                  <span className="text-dim">—</span>
                )}
              </td>
              <td className="whitespace-nowrap font-mono text-xs text-dim">{date(u.created_at)}</td>
              <td className="text-right">
                {!u.is_superuser && (
                  <Button
                    size="sm"
                    tone={u.is_active ? "default" : "signal"}
                    disabled={toggle.isPending}
                    onClick={() => {
                      if (u.is_active && !window.confirm(`Block ${u.email} from signing in?`))
                        return;
                      toggle.mutate(u);
                    }}
                  >
                    {u.is_active ? "Block" : "Unblock"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
