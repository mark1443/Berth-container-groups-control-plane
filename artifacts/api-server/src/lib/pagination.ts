import { ValidationError } from "./errors";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  page: number;
  pageSize: number;
  offset: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * Read `page` / `pageSize` from a query object. Out-of-range input is a
 * 422 VALIDATION_ERROR rather than a silent clamp, so a client that asks
 * for 1000 items learns the limit instead of quietly receiving 200.
 */
export function parsePagination(query: Record<string, unknown>): PageRequest {
  const page = readInt(query.page, 1, "page");
  const pageSize = readInt(query.pageSize, DEFAULT_PAGE_SIZE, "pageSize");
  if (page < 1) {
    throw new ValidationError("page must be at least 1", { page });
  }
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ValidationError(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`, {
      pageSize,
      max: MAX_PAGE_SIZE,
    });
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginate<T>(
  data: T[],
  totalItems: number,
  { page, pageSize }: Pick<PageRequest, "page" | "pageSize">,
): Paginated<T> {
  return {
    data,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    },
  };
}

/** Paginate an already-materialised array (small in-memory collections). */
export function paginateArray<T>(items: T[], req: PageRequest): Paginated<T> {
  return paginate(items.slice(req.offset, req.offset + req.pageSize), items.length, req);
}

function readInt(raw: unknown, fallback: number, name: string): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(String(raw));
  if (!Number.isInteger(n)) {
    throw new ValidationError(`${name} must be an integer`, { [name]: raw });
  }
  return n;
}
