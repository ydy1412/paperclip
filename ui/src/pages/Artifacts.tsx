import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FolderInput, FolderPlus, Layers, Package, Pencil, Search, X } from "lucide-react";
import type { FolderListItem } from "@paperclipai/shared";
import type { To } from "react-router-dom";
import {
  artifactsApi,
  type ArtifactGroupBy,
  type ArtifactKindFilter,
} from "../api/artifacts";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ArtifactCard } from "../components/artifacts/ArtifactCard";
import { ArtifactDeleteButton } from "../components/artifacts/ArtifactDeleteButton";
import { ArtifactImportButton } from "../components/artifacts/ArtifactImportButton";
import { ArtifactGroupCard } from "../components/artifacts/ArtifactGroupCard";
import { useSearchParams, Link } from "@/lib/router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { foldersApi } from "../api/folders";
import { FolderFormDialog } from "../components/folders/FolderControls";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";

const ARTIFACTS_PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 250;

export const ARTIFACT_KIND_FILTERS: { value: ArtifactKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "document", label: "Documents" },
  { value: "text", label: "Text" },
  { value: "file", label: "Files" },
];

export const ARTIFACT_GROUP_OPTIONS: { value: ArtifactGroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "task", label: "Task" },
  { value: "parent_task", label: "Parent task" },
];

const KIND_VALUES = new Set(ARTIFACT_KIND_FILTERS.map((filter) => filter.value));

function parseGroupBy(value: string | null): ArtifactGroupBy {
  if (value === "none" || value === "task" || value === "parent_task") return value;
  return "task";
}

function parseKind(value: string | null): ArtifactKindFilter {
  return value && KIND_VALUES.has(value as ArtifactKindFilter)
    ? (value as ArtifactKindFilter)
    : "all";
}

export function artifactGroupByLabel(value: ArtifactGroupBy): string {
  return ARTIFACT_GROUP_OPTIONS.find((option) => option.value === value)?.label ?? "None";
}

export function Artifacts() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();

  const kind = parseKind(searchParams.get("kind"));
  const query = searchParams.get("q") ?? "";
  const groupBy = parseGroupBy(searchParams.get("groupBy"));
  const groupIssueId = searchParams.get("groupIssueId") ?? undefined;
  const folderId = searchParams.get("folderId") ?? undefined;
  const queryClient = useQueryClient();
  const [folderForm, setFolderForm] = useState<"create" | "edit" | null>(null);
  const [movingFolder, setMovingFolder] = useState(false);
  const [parentId, setParentId] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const folderQuery = useQuery({
    queryKey: ["folders", selectedCompanyId, "artifact"],
    queryFn: () => foldersApi.list(selectedCompanyId!, "artifact"),
    enabled: !!selectedCompanyId,
  });
  const folders = folderQuery.data?.folders ?? [];
  const selectedFolder = folders.find((folder) => folder.id === folderId) ?? null;
  const refreshFolders = async () => {
    await queryClient.invalidateQueries({ queryKey: ["folders", selectedCompanyId, "artifact"] });
    await queryClient.invalidateQueries({ queryKey: ["artifacts", selectedCompanyId] });
  };
  const folderMutation = useMutation({
    mutationFn: async (action: { type: "save"; name: string; color: string | null; editing: FolderListItem | null } | { type: "move"; folder: FolderListItem; parentId: string | null } | { type: "entry"; artifactId: string; folderId: string | null }) => {
      if (action.type === "entry") return artifactsApi.moveToFolder(selectedCompanyId!, action.artifactId, action.folderId);
      if (action.type === "move") return foldersApi.moveFolder(selectedCompanyId!, action.folder.id, { parentId: action.parentId, position: 0 });
      if (action.editing) return foldersApi.update(selectedCompanyId!, action.editing.id, { name: action.name, color: action.color });
      return foldersApi.create(selectedCompanyId!, { kind: "artifact", parentId: folderId ?? null, name: action.name, color: action.color });
    },
    onMutate: () => setFolderError(null),
    onSuccess: async () => {
      setFolderForm(null);
      setMovingFolder(false);
      await refreshFolders();
    },
    onError: (error) => setFolderError(error.message),
  });

  const [draftQuery, setDraftQuery] = useState(query);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const grouping = groupBy !== "none";
  const viewingStackList = grouping && !groupIssueId;
  const viewingSelectedStack = grouping && !!groupIssueId;

  // Keep the search box in sync when the committed query changes from outside
  // (e.g. back/forward navigation or a shared URL), without clobbering in-flight
  // typing (which leaves `query` unchanged until the debounce commits).
  useEffect(() => {
    setDraftQuery((prev) => (prev.trim() === query ? prev : query));
  }, [query]);

  // Debounce the search box into the `q` URL param so searches are shareable.
  useEffect(() => {
    const trimmed = draftQuery.trim();
    if (trimmed === query) return;
    const handle = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (trimmed) next.set("q", trimmed);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draftQuery, query, setSearchParams]);

  const updateParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      });
    },
    [setSearchParams],
  );

  const selectKind = useCallback(
    (value: ArtifactKindFilter) => {
      updateParams((next) => {
        if (value === "all") next.delete("kind");
        else next.set("kind", value);
      });
    },
    [updateParams],
  );

  const selectGroupBy = useCallback(
    (value: ArtifactGroupBy) => {
      updateParams((next) => {
        // Switching the grouping mode always returns to the stack list.
        next.delete("groupIssueId");
        if (value === "task") next.delete("groupBy");
        else next.set("groupBy", value);
      });
    },
    [updateParams],
  );

  // Build a relative `To` that preserves the active filters/search while
  // changing only the grouping selection. A bare query string keeps the current
  // pathname (the company-prefixed /artifacts route) and stays linkable.
  const buildTo = useCallback(
    (mutate: (next: URLSearchParams) => void): To => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      const serialized = next.toString();
      return serialized ? `?${serialized}` : "?";
    },
    [searchParams],
  );

  const stackTo = useCallback(
    (issueId: string): To =>
      buildTo((next) => {
        if (groupBy === "task") next.delete("groupBy");
        else if (groupBy !== "none") next.set("groupBy", groupBy);
        next.set("groupIssueId", issueId);
      }),
    [buildTo, groupBy],
  );

  const backToStacksTo = useMemo<To>(
    () =>
      buildTo((next) => {
        if (groupBy === "task") next.delete("groupBy");
        next.delete("groupIssueId");
      }),
    [buildTo, groupBy],
  );

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteQuery({
    queryKey: [...queryKeys.artifacts.list(selectedCompanyId!, kind, query, groupBy, groupIssueId), folderId ?? null],
    queryFn: ({ pageParam }) =>
      artifactsApi.list(selectedCompanyId!, {
        kind,
        q: query || undefined,
        groupBy,
        groupIssueId,
        ...(folderId ? { folderId } : {}),
        limit: ARTIFACTS_PAGE_SIZE,
        cursor: pageParam,
      }),
    enabled: !!selectedCompanyId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void fetchNextPage();
      }
    }, { rootMargin: "320px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const artifacts = useMemo(() => data?.pages.flatMap((page) => page.artifacts) ?? [], [data]);
  const groups = useMemo(
    () => data?.pages.flatMap((page) => page.groups ?? []) ?? [],
    [data],
  );
  const selectedGroup = useMemo(
    () => data?.pages.map((page) => page.selectedGroup).find(Boolean) ?? null,
    [data],
  );
  const searching = query.length > 0;

  useEffect(() => {
    if (viewingSelectedStack && selectedGroup) {
      setBreadcrumbs([
        { label: "Artifacts", href: "/artifacts" },
        { label: `${selectedGroup.issue.identifier} · ${selectedGroup.title}` },
      ]);
    } else {
      setBreadcrumbs([{ label: "Artifacts" }]);
    }
  }, [setBreadcrumbs, viewingSelectedStack, selectedGroup]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Package} message="Select an organization to view artifacts." />;
  }

  const showGroupCards = viewingStackList;
  const items = showGroupCards ? groups : artifacts;

  const emptyMessage = showGroupCards
    ? searching
      ? "No artifact stacks match this search."
      : "No artifact stacks yet."
    : searching
      ? "No artifacts match this search."
      : viewingSelectedStack
        ? "No artifacts in this stack match the current filters."
        : kind === "all"
          ? "No artifacts yet. Outputs attached to issues will appear here."
          : "No artifacts of this type yet.";

  return (
    <div className="w-full max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.currentTarget.value)}
            placeholder="Search artifacts..."
            aria-label="Search artifacts"
            className="h-9 pl-9 pr-9 text-sm"
          />
          {draftQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setDraftQuery("")}
              aria-label="Clear artifact search"
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Group artifacts (currently ${artifactGroupByLabel(groupBy)})`}
                title="Group artifacts"
                data-testid="artifact-group-control"
                data-group-by={groupBy}
                className={cn("h-8 w-8 shrink-0", grouping && "bg-accent")}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Group by</DropdownMenuLabel>
              {ARTIFACT_GROUP_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  data-testid={`artifact-group-option-${option.value}`}
                  aria-selected={groupBy === option.value}
                  onSelect={() => selectGroupBy(option.value)}
                  className="justify-between"
                >
                  {option.label}
                  {groupBy === option.value ? <Check className="h-3.5 w-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter artifacts by type">
            {ARTIFACT_KIND_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={kind === filter.value}
                onClick={() => selectKind(filter.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  kind === filter.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Artifact folder"
          value={folderId ?? ""}
          disabled={folderQuery.isLoading || !!folderQuery.error || folderMutation.isPending}
          className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm sm:max-w-sm"
          onChange={(event) => updateParams((next) => {
            if (event.target.value) next.set("folderId", event.target.value);
            else next.delete("folderId");
            next.delete("groupIssueId");
          })}
        >
          <option value="">All folders</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path || folder.name}</option>)}
        </select>
        <Button variant="outline" size="icon" aria-label="Create artifact folder" title="Create artifact folder" disabled={folderMutation.isPending || !!folderQuery.error} onClick={() => { setFolderError(null); setFolderForm("create"); }}><FolderPlus className="h-4 w-4"/></Button>
        {selectedFolder && <>
          <Button variant="outline" size="icon" aria-label="Rename artifact folder" title="Rename artifact folder" disabled={folderMutation.isPending} onClick={() => { setFolderError(null); setFolderForm("edit"); }}><Pencil className="h-4 w-4"/></Button>
          <Button variant="outline" size="icon" aria-label="Move artifact folder" title="Move artifact folder" disabled={folderMutation.isPending} onClick={() => { setFolderError(null); setParentId(selectedFolder.parentId ?? ""); setMovingFolder(true); }}><FolderInput className="h-4 w-4"/></Button>
        </>}
      </div>
      {folderQuery.error && <p role="alert" className="text-sm text-destructive">{folderQuery.error.message}</p>}
      {folderError && <p role="alert" className="text-sm text-destructive">{folderError}</p>}
      <FolderFormDialog open={folderForm !== null} kind="artifact" folder={folderForm === "edit" ? selectedFolder : null} pending={folderMutation.isPending} error={folderError} onOpenChange={(open) => { if (!open && !folderMutation.isPending) setFolderForm(null); }} onSubmit={(payload) => folderMutation.mutate({ type: "save", ...payload, editing: folderForm === "edit" ? selectedFolder : null })}/>
      <Dialog open={movingFolder} onOpenChange={(open) => { if (!folderMutation.isPending) setMovingFolder(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Move {selectedFolder?.name}</DialogTitle></DialogHeader>
          <select aria-label="Destination parent folder" value={parentId} onChange={(event) => setParentId(event.target.value)} disabled={folderMutation.isPending} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Top level</option>
            {folders.filter((folder) => folder.id !== folderId && !folder.path.startsWith(`${selectedFolder?.path}/`)).map((folder) => <option key={folder.id} value={folder.id}>{folder.path || folder.name}</option>)}
          </select>
          {folderError && <p role="alert" className="text-sm text-destructive">{folderError}</p>}
          <DialogFooter>
            <Button variant="ghost" disabled={folderMutation.isPending} onClick={() => setMovingFolder(false)}>Cancel</Button>
            <Button disabled={folderMutation.isPending || !selectedFolder} onClick={() => selectedFolder && folderMutation.mutate({ type: "move", folder: selectedFolder, parentId: parentId || null })}>{folderMutation.isPending ? "Moving..." : "Move folder"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewingSelectedStack ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to={backToStacksTo}
            data-testid="artifact-stack-back"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All stacks
          </Link>
          {selectedGroup ? (
            <span className="truncate text-muted-foreground">
              <span className="text-foreground/80">{selectedGroup.issue.identifier}</span>{" "}
              {selectedGroup.title}
            </span>
          ) : null}
        </div>
      ) : null}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {isLoading ? (
        <PageSkeleton variant="list" />
      ) : items.length === 0 ? (
        <EmptyState icon={showGroupCards ? Layers : Package} message={emptyMessage} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {showGroupCards
              ? groups.map((group) => (
                  <ArtifactGroupCard key={group.id} group={group} to={stackTo(group.issue.id)} />
                ))
              : artifacts.map((artifact) => (
                  <div key={`${artifact.source}:${artifact.id}`} className="min-w-0">
                    <ArtifactCard artifact={artifact} />
                    <div className="flex items-center justify-end gap-2">
                      <select aria-label={`Move ${artifact.title} to folder`} value="" disabled={folderMutation.isPending || folderQuery.isLoading || !!folderQuery.error} className="h-8 min-w-0 max-w-48 rounded-md border border-input bg-background px-2 text-xs" onChange={(event) => { if (event.target.value) folderMutation.mutate({ type: "entry", artifactId: artifact.id, folderId: event.target.value === "unfiled" ? null : event.target.value }); }}>
                        <option value="" disabled>Move to...</option>
                        <option value="unfiled">Unfiled</option>
                        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path || folder.name}</option>)}
                      </select>
                      <ArtifactDeleteButton artifact={artifact} companyId={selectedCompanyId}/>
                      <ArtifactImportButton artifact={artifact} companyId={selectedCompanyId}/>
                    </div>
                  </div>
                ))}
          </div>
          <div ref={loadMoreRef} className="flex min-h-10 items-center justify-center pb-2 text-xs text-muted-foreground">
            {isFetchingNextPage
              ? "Loading more artifacts..."
              : hasNextPage
                ? null
                : isFetching
                  ? "Updating artifacts..."
                  : null}
          </div>
        </>
      )}
    </div>
  );
}
